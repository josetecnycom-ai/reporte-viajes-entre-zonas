geotab.addin.reporteViajes = function(api, state) {
    
    let chartViajes = null;
    let chartKm = null;
    let chartHourly = null;

    const colorPalette = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2', '#ea580c', '#475569'];

    const msToTime = (ms) => {
        if (!ms || ms < 0) return "0h 0m";
        let minutes = Math.floor((ms / (1000 * 60)) % 60);
        let hours = Math.floor((ms / (1000 * 60 * 60)));
        return `${hours}h ${minutes}m`;
    };

    const ruleIDs = {
        salidaAeropuerto: "aRPt3sFCSxEW5TahYwI0KqQ",
        salidaBase: "aEBQIqbANNEC9sVB-MSS6zA",
        entradaAeropuerto: "a0aBO--UvHUy25MpdQMx6bA",
        entradaBase: "aJMkqgpUAr0uohlAzyLwAog"
    };

    return {
        initialize: function(api, state, callback) {
            try {
                const formatLocal = (d) => {
                    const pad = (n) => n.toString().padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                };

                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const dFromDefault = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0);
                const dToDefault = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59);

                document.getElementById("dateFrom").value = formatLocal(dFromDefault);
                document.getElementById("dateTo").value = formatLocal(dToDefault);

                api.call("Get", { typeName: "Device" }).then(devices => {
                    const optionsContainer = document.getElementById("deviceOptions");
                    const header = document.getElementById("deviceHeader");
                    optionsContainer.innerHTML = ""; 
                    devices.sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
                        let lbl = document.createElement("label");
                        lbl.innerHTML = `<input type="checkbox" value="${d.id}" data-name="${d.name}"> ${d.name}`;
                        optionsContainer.appendChild(lbl);
                    });
                    optionsContainer.addEventListener('change', () => {
                        const checked = Array.from(optionsContainer.querySelectorAll('input:checked'));
                        header.innerText = checked.length === 0 ? "Seleccionar vehículos..." : 
                                         checked.length <= 2 ? checked.map(cb => cb.dataset.name).join(', ') : 
                                         `${checked.length} vehículos seleccionados`;
                    });
                    callback();
                });

                document.getElementById("btnGenerar").onclick = () => processData(api);
                document.getElementById("btnExportar").onclick = exportExcel;
            } catch (error) { console.error(error); callback(); }
        }
    };

    async function processData(api) {
        document.getElementById("loadingMsg").style.display = "block";
        const checkedBoxes = Array.from(document.querySelectorAll('#deviceOptions input:checked'));
        const dFrom = new Date(document.getElementById("dateFrom").value);
        const dTo = new Date(document.getElementById("dateTo").value);
        
        const numDays = Math.max(1, Math.ceil(Math.abs(dTo - dFrom) / (1000 * 60 * 60 * 24)));
        let allRows = [];
        let summaryData = {}; 

        for (let cb of checkedBoxes) {
            const deviceId = cb.value;
            const name = cb.dataset.name;
            summaryData[name] = { viajes: 0, totalKm: 0, totalMsRuta: 0, msBase: 0, msAero: 0, viajesPorHora: new Array(24).fill(0) };

            const [events, odoData] = await Promise.all([
                api.call("Get", { typeName: "ExceptionEvent", search: { deviceSearch: { id: deviceId }, fromDate: dFrom.toISOString(), toDate: dTo.toISOString() }}),
                api.call("Get", { typeName: "StatusData", search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: "DiagnosticOdometerId" }, fromDate: dFrom.toISOString(), toDate: dTo.toISOString() }})
            ]);

            const ruleEvents = events.filter(e => e.rule && Object.values(ruleIDs).includes(e.rule.id)).sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));
            let lastEntrada = null, lastSalida = null;

            for (let e of ruleEvents) {
                if (e.rule.id === ruleIDs.entradaBase || e.rule.id === ruleIDs.entradaAeropuerto) {
                    lastEntrada = e;
                    if (lastSalida) {
                        let tSalida = new Date(lastSalida.activeFrom), tLlegada = new Date(e.activeFrom);
                        let durMs = tLlegada - tSalida;
                        let origenEsBase = lastSalida.rule.id === ruleIDs.salidaBase;
                        let destinoEsBase = e.rule.id === ruleIDs.entradaBase;

                        if (durMs > 0 && origenEsBase !== destinoEsBase) {
                            const getOdo = (time) => {
                                if (odoData.length === 0) return null;
                                const closest = odoData.reduce((prev, curr) => Math.abs(new Date(curr.dateTime) - time) < Math.abs(new Date(prev.dateTime) - time) ? curr : prev);
                                return closest.data / 1000; 
                            };
                            let odoIni = getOdo(tSalida), odoFin = getOdo(tLlegada);
                            let dist = (odoIni !== null && odoFin !== null) ? (odoFin - odoIni) : 0;
                            let esEstimado = false;
                            if (dist < 0.1) { dist = (durMs / 3600000) * 42.5; esEstimado = true; }

                            allRows.push({
                                fecha: tSalida.toLocaleDateString(),
                                hora: tSalida.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                                vehiculo: name,
                                origen: origenEsBase ? "Base" : "Aeropuerto",
                                destino: destinoEsBase ? "Base" : "Aeropuerto",
                                duracion: msToTime(durMs),
                                km: dist.toFixed(2) + (esEstimado ? " (*)" : "")
                            });
                            summaryData[name].viajes++;
                            summaryData[name].totalKm += dist;
                            summaryData[name].totalMsRuta += durMs;
                            summaryData[name].viajesPorHora[tSalida.getHours()]++;
                        }
                        lastSalida = null;
                    }
                } else {
                    lastSalida = e;
                    if (lastEntrada) {
                        let estanciaMs = new Date(e.activeFrom) - new Date(lastEntrada.activeFrom);
                        if (lastEntrada.rule.id === ruleIDs.entradaBase) summaryData[name].msBase += estanciaMs;
                        else summaryData[name].msAero += estanciaMs;
                        lastEntrada = null;
                    }
                }
            }
        }
        renderDashboard(summaryData, numDays);
        renderDetail(allRows);
        document.getElementById("loadingMsg").style.display = "none";
        document.getElementById("dashboardPanel").style.display = "flex";
        document.getElementById("detailPanel").style.display = "block";
    }

    function renderDashboard(data, days) {
        let html = `<table><thead><tr><th>Vehículo</th><th>Viajes Tot.</th><th>Km Totales</th><th>Tiempo Conducción</th><th>Viajes/Día</th><th>Km/Día</th><th>Permanencia Base/Día</th><th>Permanencia Aero/Día</th></tr></thead><tbody>`;
        let labels = [], vData = [], kData = [], hourlyDatasets = [], colorIndex = 0;

        Object.keys(data).forEach(name => {
            const d = data[name];
            if (d.viajes > 0) {
                html += `<tr><td style="font-weight:bold; color:#2563eb">${name}</td><td>${d.viajes}</td><td>${d.totalKm.toFixed(1)} km</td><td>${msToTime(d.totalMsRuta)}</td><td>${(d.viajes/days).toFixed(1)}</td><td>${(d.totalKm/days).toFixed(1)} km</td><td>${msToTime(d.msBase/days)}</td><td>${msToTime(d.msAero/days)}</td></tr>`;
                labels.push(name); vData.push((d.viajes/days).toFixed(1)); kData.push((d.totalKm/days).toFixed(1));
                hourlyDatasets.push({ label: name, data: d.viajesPorHora, borderColor: colorPalette[colorIndex % colorPalette.length], backgroundColor: colorPalette[colorIndex % colorPalette.length] + '22', borderWidth: 3, tension: 0.4, fill: true });
                colorIndex++;
            }
        });
        document.getElementById("summaryTableContainer").innerHTML = html + "</tbody></table>";
        
        if (chartViajes) chartViajes.destroy(); if (chartKm) chartKm.destroy(); if (chartHourly) chartHourly.destroy();

        const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } };

        chartHourly = new Chart(document.getElementById('hourlyChart'), { type: 'line', data: { labels: Array.from({length: 24}, (_, i) => `${i}:00`), datasets: hourlyDatasets }, options: opts });
        chartViajes = new Chart(document.getElementById('viajesChart'), { type: 'bar', data: { labels, datasets: [{ label: 'Viajes / Día', data: vData, backgroundColor: '#2563eb' }] }, options: opts });
        chartKm = new Chart(document.getElementById('kmChart'), { type: 'bar', data: { labels, datasets: [{ label: 'Km / Día', data: kData, backgroundColor: '#16a34a' }] }, options: opts });
    }

    function renderDetail(rows) {
        let html = `<table><thead><tr><th>Fecha</th><th>Hora Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Distancia</th></tr></thead><tbody>`;
        html += rows.map(r => `<tr><td>${r.fecha}</td><td>${r.hora}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.km} km</td></tr>`).join('');
        document.getElementById("tableContainer").innerHTML = html + "</tbody></table>";
    }

    function exportExcel() {
        try {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#summaryTableContainer table")), "Resumen");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#tableContainer table")), "Detalle");
            XLSX.writeFile(wb, "Reporte_Lanzaderas.xlsx");
        } catch (e) { alert("Error al exportar. Asegúrate de haber generado el informe."); }
    }
};