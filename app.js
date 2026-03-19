geotab.addin.reporteViajes = function(api, state) {
    let chartViajes = null, chartKm = null, chartHourly = null;
    const colorPalette = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2', '#ea580c'];

    const msToTime = (ms) => {
        if (!ms || ms < 0) return "0h 0m";
        let m = Math.floor((ms / 60000) % 60);
        let h = Math.floor(ms / 3600000);
        return `${h}h ${m}m`;
    };

    const ruleIDs = {
        salidaAeropuerto: "aRPt3sFCSxEW5TahYwI0KqQ",
        salidaBase: "aEBQIqbANNEC9sVB-MSS6zA",
        entradaAeropuerto: "a0aBO--UvHUy25MpdQMx6bA",
        entradaBase: "aJMkqgpUAr0uohlAzyLwAog"
    };

    return {
        initialize: function(api, state, callback) {
            const formatLocal = (d) => {
                const pad = (n) => n.toString().padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            const d = new Date(); d.setDate(d.getDate() - 1);
            document.getElementById("dateFrom").value = formatLocal(new Date(d.setHours(0,0,0)));
            document.getElementById("dateTo").value = formatLocal(new Date(d.setHours(23,59,0)));

            api.call("Get", { typeName: "Device" }).then(devices => {
                const opt = document.getElementById("deviceOptions");
                devices.sort((a,b) => a.name.localeCompare(b.name)).forEach(dev => {
                    let lbl = document.createElement("label");
                    lbl.style.display = "block"; lbl.style.padding = "5px 0";
                    lbl.innerHTML = `<input type="checkbox" value="${dev.id}" data-name="${dev.name}"> ${dev.name}`;
                    opt.appendChild(lbl);
                });
                callback();
            });

            document.getElementById("btnGenerar").onclick = () => processData(api);
            document.getElementById("btnExportar").onclick = exportExcel;
        }
    };

    async function processData(api) {
        document.getElementById("loadingMsg").style.display = "block";
        const checked = Array.from(document.querySelectorAll('#deviceOptions input:checked'));
        const dFrom = new Date(document.getElementById("dateFrom").value).toISOString();
        const dTo = new Date(document.getElementById("dateTo").value).toISOString();
        const numDays = Math.max(1, Math.ceil(Math.abs(new Date(dTo) - new Date(dFrom)) / 86400000));

        let rows = [], summary = {};

        for (let dev of checked) {
            const id = dev.value, name = dev.dataset.name;
            summary[name] = { v: 0, km: 0, msR: 0, msB: 0, msA: 0, hrs: new Array(24).fill(0) };

            const [events, odo] = await Promise.all([
                api.call("Get", { typeName: "ExceptionEvent", search: { deviceSearch: { id }, fromDate: dFrom, toDate: dTo }}),
                api.call("Get", { typeName: "StatusData", search: { deviceSearch: { id }, diagnosticSearch: { id: "DiagnosticOdometerId" }, fromDate: dFrom, toDate: dTo }})
            ]);

            const relevant = events.filter(e => Object.values(ruleIDs).includes(e.rule.id)).sort((a,b) => new Date(a.activeFrom) - new Date(b.activeFrom));
            let lastS = null, lastE = null;

            relevant.forEach(e => {
                if (e.rule.id === ruleIDs.entradaBase || e.rule.id === ruleIDs.entradaAeropuerto) {
                    if (lastS) {
                        let tS = new Date(lastS.activeFrom), tE = new Date(e.activeFrom);
                        let dur = tE - tS;
                        // Regla de negocio: Origen debe ser distinto a Destino
                        if (dur > 0 && (lastS.rule.id === ruleIDs.salidaBase) !== (e.rule.id === ruleIDs.entradaBase)) {
                            
                            // MEJORA: Buscar odómetro real (sin redondear)
                            const findOdo = (t) => {
                                if (!odo.length) return null;
                                return odo.reduce((prev, curr) => Math.abs(new Date(curr.dateTime) - t) < Math.abs(new Date(prev.dateTime) - t) ? curr : prev).data / 1000;
                            };

                            let startOdo = findOdo(tS), endOdo = findOdo(tE);
                            let dist = (startOdo !== null && endOdo !== null) ? (endOdo - startOdo) : 0;
                            let isEst = false;
                            
                            // Si la diferencia es 0 o ilógica (menos de 100 metros), estimamos por GPS/Tiempo
                            if (dist < 0.1) {
                                dist = (dur / 3600000) * 44.2; // 44.2 km/h es una media más realista para este servicio
                                isEst = true;
                            }

                            rows.push({
                                f: tS.toLocaleDateString(),
                                h: tS.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                                n: name,
                                o: lastS.rule.id === ruleIDs.salidaBase ? "Base" : "Aero",
                                d: e.rule.id === ruleIDs.entradaBase ? "Base" : "Aero",
                                dur: msToTime(dur),
                                km: dist.toFixed(2) + (isEst ? " (*)" : "") // FORZAMOS 2 DECIMALES
                            });

                            summary[name].v++;
                            summary[name].km += dist;
                            summary[name].msR += dur;
                            summary[name].hrs[tS.getHours()]++;
                        }
                    }
                    lastE = e; lastS = null;
                } else {
                    if (lastE) {
                        let stay = new Date(e.activeFrom) - new Date(lastE.activeFrom);
                        if (lastE.rule.id === ruleIDs.entradaBase) summary[name].msB += stay; else summary[name].msA += stay;
                    }
                    lastS = e; lastE = null;
                }
            });
        }
        updateDashboard(summary, numDays, rows);
    }

    function updateDashboard(summary, days, rows) {
        document.getElementById("loadingMsg").style.display = "none";
        document.getElementById("dashboardPanel").style.display = "block";

        // Render Tabla Resumen
        let sHtml = `<table><thead><tr><th>Vehículo</th><th>Viajes Tot.</th><th>Km Tot.</th><th>V/Día</th><th>Km/Día</th><th>Media Trayecto</th><th>Permanencia Base/Día</th></tr></thead><tbody>`;
        let labs = [], vD = [], kD = [], hDs = [], cI = 0;

        Object.keys(summary).forEach(name => {
            const s = summary[name];
            if (s.v > 0) {
                sHtml += `<tr><td><b>${name}</b></td><td>${s.v}</td><td>${s.km.toFixed(2)} km</td><td>${(s.v/days).toFixed(1)}</td><td>${(s.km/days).toFixed(2)} km</td><td>${msToTime(s.msR/s.v)}</td><td>${msToTime(s.msB/days)}</td></tr>`;
                labs.push(name); vD.push((s.v/days).toFixed(1)); kD.push((s.km/days).toFixed(2));
                hDs.push({ label: name, data: s.hrs, borderColor: colorPalette[cI % colorPalette.length], backgroundColor: colorPalette[cI % colorPalette.length]+'11', tension: 0.3, fill: true });
                cI++;
            }
        });
        document.getElementById("summaryTableContainer").innerHTML = sHtml + "</tbody></table>";

        // Render Tabla Detalle
        let dHtml = `<table><thead><tr><th>Fecha</th><th>Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Distancia</th></tr></thead><tbody>`;
        dHtml += rows.map(r => `<tr><td>${r.f}</td><td>${r.h}</td><td>${r.n}</td><td>${r.o}</td><td>${r.d}</td><td>${r.dur}</td><td><b>${r.km} km</b></td></tr>`).join('');
        document.getElementById("tableContainer").innerHTML = dHtml + "</tbody></table>";

        // Gráficos
        if (chartViajes) chartViajes.destroy(); if (chartKm) chartKm.destroy(); if (chartHourly) chartHourly.destroy();
        const opt = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } };

        chartHourly = new Chart(document.getElementById('hourlyChart'), { type: 'line', data: { labels: Array.from({length:24},(_,i)=>i+":00"), datasets: hDs }, options: opt });
        chartViajes = new Chart(document.getElementById('viajesChart'), { type: 'bar', data: { labels: labs, datasets: [{ label: 'Viajes / Día', data: vD, backgroundColor: '#2563eb' }] }, options: opt });
        chartKm = new Chart(document.getElementById('kmChart'), { type: 'bar', data: { labels: labs, datasets: [{ label: 'Km / Día', data: kD, backgroundColor: '#16a34a' }] }, options: opt });
    }

    function exportExcel() {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#summaryTableContainer table")), "Resumen");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#tableContainer table")), "Detalle");
        XLSX.writeFile(wb, "Informe_Lanzaderas_K10.xlsx");
    }
};
