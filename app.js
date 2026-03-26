geotab.addin.reporteViajes = function(api, state) {
    let chartViajes = null;
    let chartKm = null;
    let chartTimeline = null;

    const colorPalette = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#eab308', '#64748b'];

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
        document.getElementById("dashboardPanel").style.display = "none";
        document.getElementById("btnExportar").style.display = "none";
        
        const checkedBoxes = Array.from(document.querySelectorAll('#deviceOptions input:checked'));
        const dFrom = new Date(document.getElementById("dateFrom").value);
        const dTo = new Date(document.getElementById("dateTo").value);
        
        const numDays = Math.max(1, Math.ceil(Math.abs(dTo - dFrom) / (1000 * 60 * 60 * 24)));
        
        // Generate array of days for timeline chart matching selected range
        const daysArray = [];
        let curr = new Date(dFrom);
        curr.setHours(0,0,0,0);
        const endD = new Date(dTo);
        endD.setHours(23,59,59,999);
        while(curr <= endD) {
            daysArray.push(curr.toLocaleDateString());
            curr.setDate(curr.getDate() + 1);
        }

        let allRows = [];
        let summaryData = {};
        
        let globalViajes = 0;
        let globalKm = 0;
        let globalDuracionMs = 0;

        for (let cb of checkedBoxes) {
            const deviceId = cb.value;
            const name = cb.dataset.name;
            summaryData[name] = { 
                viajes: 0, 
                totalKm: 0, 
                totalMsRuta: 0, 
                msBase: 0, 
                msAero: 0, 
                viajesPorDia: Array(daysArray.length).fill(0)
            };

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

                        // Solo registrar si origen y destino son distintos (Zonas cruzadas)
                        if (durMs > 0 && origenEsBase !== destinoEsBase) {
                            const getOdo = (time) => {
                                if (odoData.length === 0) return null;
                                // Simple closest point search
                                const closest = odoData.reduce((prev, curr) => Math.abs(new Date(curr.dateTime) - time) < Math.abs(new Date(prev.dateTime) - time) ? curr : prev);
                                return closest.data / 1000; 
                            };
                            
                            let odoIni = getOdo(tSalida), odoFin = getOdo(tLlegada);
                            // Calculo exacto sin estimaciones erróneas.
                            let dist = (odoIni !== null && odoFin !== null && odoFin > odoIni) ? (odoFin - odoIni) : 0;
                            
                            const dateStr = tSalida.toLocaleDateString();
                            const dayIndex = daysArray.indexOf(dateStr);
                            
                            allRows.push({
                                fecha: dateStr,
                                hora: tSalida.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                                vehiculo: name,
                                origen: origenEsBase ? "Base" : "Aeropuerto",
                                destino: destinoEsBase ? "Base" : "Aeropuerto",
                                duracion: msToTime(durMs),
                                km: dist.toFixed(1)
                            });
                            
                            summaryData[name].viajes++;
                            summaryData[name].totalKm += dist;
                            summaryData[name].totalMsRuta += durMs;
                            if(dayIndex !== -1) summaryData[name].viajesPorDia[dayIndex]++;
                            
                            globalViajes++;
                            globalKm += dist;
                            globalDuracionMs += durMs;
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
        
        // Actualizar KPIs Globales
        document.getElementById("kpi-viajes").innerText = globalViajes;
        document.getElementById("kpi-km").innerText = globalKm.toFixed(1);
        document.getElementById("kpi-duracion").innerText = globalViajes > 0 ? msToTime(globalDuracionMs / globalViajes) : "0m";
        document.getElementById("kpi-eficiencia").innerText = globalViajes > 0 ? (globalKm / globalViajes).toFixed(1) + " km/v" : "0.0";

        renderDashboard(summaryData, numDays, daysArray);
        renderDetail(allRows);
        
        document.getElementById("loadingMsg").style.display = "none";
        document.getElementById("dashboardPanel").style.display = "flex";
        document.getElementById("btnExportar").style.display = "inline-flex";
    }

    function renderDashboard(data, days, daysArray) {
        let html = `<table><thead><tr><th>Vehículo</th><th>Viajes Tot.</th><th>Km Totales</th><th>Eficiencia</th><th>Tiempo Coducción</th><th>Perm. Base/Día</th><th>Perm. Aero/Día</th></tr></thead><tbody>`;
        let labels = [], vData = [], kData = [], timelineDatasets = [], colorIndex = 0;

        Object.keys(data).forEach(name => {
            const d = data[name];
            if (d.viajes > 0) {
                const efi = (d.totalKm / d.viajes).toFixed(1);
                html += `<tr>
                    <td style="font-weight:600; color: #0f172a;">${name}</td>
                    <td>${d.viajes}</td>
                    <td>${d.totalKm.toFixed(1)}</td>
                    <td>${efi} km/v</td>
                    <td>${msToTime(d.totalMsRuta)}</td>
                    <td>${msToTime(d.msBase/days)}</td>
                    <td>${msToTime(d.msAero/days)}</td>
                </tr>`;
                
                labels.push(name); 
                vData.push(d.viajes); 
                kData.push(d.totalKm.toFixed(1));
                
                timelineDatasets.push({ 
                    label: name, 
                    data: d.viajesPorDia, 
                    borderColor: colorPalette[colorIndex % colorPalette.length], 
                    backgroundColor: colorPalette[colorIndex % colorPalette.length] + '22', 
                    borderWidth: 3, 
                    tension: 0.3, 
                    fill: true 
                });
                colorIndex++;
            }
        });
        
        document.getElementById("summaryTableContainer").innerHTML = html + "</tbody></table>";
        
        if (chartViajes) chartViajes.destroy(); 
        if (chartKm) chartKm.destroy(); 
        if (chartTimeline) chartTimeline.destroy();

        const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } };

        chartTimeline = new Chart(document.getElementById('timelineChart'), { 
            type: 'line', 
            data: { labels: daysArray, datasets: timelineDatasets }, 
            options: opts 
        });
        
        chartViajes = new Chart(document.getElementById('viajesChart'), { 
            type: 'bar', 
            data: { labels, datasets: [{ label: 'Viajes Totales', data: vData, backgroundColor: '#2563eb', borderRadius: 6 }] }, 
            options: opts 
        });
        
        chartKm = new Chart(document.getElementById('kmChart'), { 
            type: 'bar', 
            data: { labels, datasets: [{ label: 'Km Totales', data: kData, backgroundColor: '#10b981', borderRadius: 6 }] }, 
            options: opts 
        });
    }

    function renderDetail(rows) {
        let html = `<table><thead><tr><th>Fecha</th><th>Hora Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Distancia (Km)</th></tr></thead><tbody>`;
        if(rows.length === 0) {
            html += `<tr><td colspan="7" style="text-align: center; color: #64748b;">No hay trayectos válidos en este periodo.</td></tr>`;
        } else {
            html += rows.map(r => `<tr>
                <td style="font-weight: 500;">${r.fecha}</td>
                <td>${r.hora}</td>
                <td>${r.vehiculo}</td>
                <td><span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.8rem;">${r.origen}</span></td>
                <td><span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.8rem;">${r.destino}</span></td>
                <td>${r.duracion}</td>
                <td style="font-weight: 600; color: #10b981;">${r.km}</td>
            </tr>`).join('');
        }
        document.getElementById("tableContainer").innerHTML = html + "</tbody></table>";
    }

    function exportExcel() {
        try {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#summaryTableContainer table")), "Resumen Operativo");
            XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.querySelector("#tableContainer table")), "Trayectos Detallados");
            XLSX.writeFile(wb, "Reporte_Lanzaderas_V1.3.0.xlsx");
        } catch (e) { alert("Error al exportar. Asegúrate de haber generado el informe."); }
    }
};