geotab.addin.reporteViajes = function(api, state) {
    let chartViajes = null, chartKm = null, chartHourly = null;
    const colorPalette = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2'];

    const msToTime = (ms) => {
        if (!ms || ms < 0) return "0h 0m";
        let min = Math.floor((ms / 60000) % 60);
        let hr = Math.floor(ms / 3600000);
        return `${hr}h ${min}m`;
    };

    const ruleIDs = {
        salidaAeropuerto: "aRPt3sFCSxEW5TahYwI0KqQ",
        salidaBase: "aEBQIqbANNEC9sVB-MSS6zA",
        entradaAeropuerto: "a0aBO--UvHUy25MpdQMx6bA",
        entradaBase: "aJMkqgpUAr0uohlAzyLwAog"
    };

    return {
        initialize: function(api, state, callback) {
            const now = new Date();
            const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0);
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59);

            const toISO = (d) => d.toISOString().slice(0, 16);
            document.getElementById("dateFrom").value = toISO(yesterday);
            document.getElementById("dateTo").value = toISO(todayEnd);

            api.call("Get", { typeName: "Device" }).then(devices => {
                const opt = document.getElementById("deviceOptions");
                devices.sort((a,b) => a.name.localeCompare(b.name)).forEach(d => {
                    let lbl = document.createElement("label");
                    lbl.style.display = "block";
                    lbl.innerHTML = `<input type="checkbox" value="${d.id}" data-name="${d.name}"> ${d.name}`;
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
        const days = Math.max(1, Math.ceil(Math.abs(new Date(dTo) - new Date(dFrom)) / 86400000));

        let allRows = [], summary = {};

        for (let dev of checked) {
            const id = dev.value, name = dev.dataset.name;
            summary[name] = { v: 0, km: 0, msR: 0, msB: 0, msA: 0, hr: new Array(24).fill(0) };

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
                        if (dur > 0 && (lastS.rule.id === ruleIDs.salidaBase) !== (e.rule.id === ruleIDs.entradaBase)) {
                            const getO = (t) => {
                                if (!odo.length) return null;
                                return odo.reduce((p, c) => Math.abs(new Date(c.dateTime) - t) < Math.abs(new Date(p.dateTime) - t) ? c : p).data / 1000;
                            };
                            let o1 = getO(tS), o2 = getO(tE);
                            let d = (o1 && o2) ? (o2 - o1) : 0;
                            let est = false; if (d < 0.1) { d = (dur/3600000)*42; est = true; }

                            allRows.push({ f: tS.toLocaleDateString(), h: tS.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), v: name, o: lastS.rule.id === ruleIDs.salidaBase ? "Base":"Aero", d: e.rule.id === ruleIDs.entradaBase ? "Base":"Aero", dur: msToTime(dur), km: d.toFixed(2)+(est?" (*)":"") });
                            summary[name].v++; summary[name].km += d; summary[name].msR += dur; summary[name].hr[tS.getHours()]++;
                        }
                    }
                    lastE = e; lastS = null;
                } else {
                    if (lastE) {
                        let est = new Date(e.activeFrom) - new Date(lastE.activeFrom);
                        if (lastE.rule.id === ruleIDs.entradaBase) summary[name].msB += est; else summary[name].msA += est;
                    }
                    lastS = e; lastE = null;
                }
            });
        }
        renderUI(summary, days, allRows);
    }

    function renderUI(summary, days, rows) {
        document.getElementById("loadingMsg").style.display = "none";
        document.getElementById("dashboardPanel").style.display = "flex";
        document.getElementById("detailPanel").style.display = "block";

        let table = `<table><thead><tr><th>Vehículo</th><th>Viajes Tot.</th><th>Km Tot.</th><th>Conducción</th><th>V/Día</th><th>Km/Día</th><th>Base/Día</th><th>Aero/Día</th></tr></thead><tbody>`;
        let labs = [], vD = [], kD = [], hDs = [], cI = 0;

        Object.keys(summary).forEach(n => {
            const s = summary[n];
            if (s.v > 0) {
                table += `<tr><td><b>${n}</b></td><td>${s.v}</td><td>${s.km.toFixed(1)}</td><td>${msToTime(s.msR)}</td><td>${(s.v/days).toFixed(1)}</td><td>${(s.km/days).toFixed(1)}</td><td>${msToTime(s.msB/days)}</td><td>${msToTime(s.msA/days)}</td></tr>`;
                labs.push(n); vD.push((s.v/days).toFixed(1)); kD.push((s.km/days).toFixed(1));
                hDs.push({ label: n, data: s.hr, borderColor: colorPalette[cI % colorPalette.length], tension: 0.4 });
                cI++;
            }
        });
        document.getElementById("summaryTableContainer").innerHTML = table + "</tbody></table>";

        const detail = `<table><thead><tr><th>Fecha</th><th>Hora</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Km</th></tr></thead><tbody>` + 
                       rows.map(r => `<tr><td>${r.f}</td><td>${r.h}</td><td>${r.v}</td><td>${r.o}</td><td>${r.d}</td><td>${r.dur}</td><td>${r.km} km</td></tr>`).join('') + "</tbody></table>";
        document.getElementById("tableContainer").innerHTML = detail;

        if (chartViajes) chartViajes.destroy(); if (chartKm) chartKm.destroy(); if (chartHourly) chartHourly.destroy();
        const cfg = { responsive: true, maintainAspectRatio: false };

        chartHourly = new Chart(document.getElementById('hourlyChart'), { type: 'line', data: { labels: Array.from({length:24},(_,i)=>i+":00"), datasets: hDs }, options: cfg });
        chartViajes = new Chart(document.getElementById('viajesChart'), { type: 'bar', data: { labels: labs, datasets: [{label:'Viajes/Día', data:vD, backgroundColor:'#2563eb'}] }, options: cfg });
        chartKm = new Chart(document.getElementById('kmChart'), { type: 'bar', data: { labels: labs, datasets: [{label:'Km/Día', data:kD, backgroundColor:'#16a34a'}] }, options: cfg });
    }

    function exportExcel() {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#summaryTableContainer table")), "Resumen");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#tableContainer table")), "Detalle");
        XLSX.writeFile(wb, "Informe_K10.xlsx");
    }
};
