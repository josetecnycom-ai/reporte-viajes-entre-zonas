geotab.addin.reporteViajes = function(api, state) {
    
    let chartViajes = null;
    let chartKm = null;
    let chartHourly = null;

    // Paleta de colores para diferenciar las furgonetas en el gráfico de líneas
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
                // LÓGICA PARA CARGAR "EL DÍA DE AYER" POR DEFECTO
                const formatLocal = (d) => {
                    const pad = (n) => n.toString().padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                };

                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1); // Restamos un día a hoy
                
                // Desde las 00:00 de ayer
                const dFromDefault = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0);
                // Hasta las 23:59 de ayer
                const dToDefault = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59);

                document.getElementById("dateFrom").value = formatLocal(dFromDefault);
                document.getElementById("dateTo").value = formatLocal(dToDefault);

                // Selector de dispositivos
                document.addEventListener('click', (e) => {
                    const ms = document.getElementById('ms-devices');
                    if (ms && !ms.contains(e.target)) ms.classList.remove('open');
                });

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
        const fromDate = dFrom.toISOString();
        const toDate = dTo.toISOString();
        
        const diffTime = Math.abs(dTo - dFrom);
        const numDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        let allRows = [];
        let summaryData = {}; 

        for (let cb of checkedBoxes) {
            const deviceId = cb.value;
            const name = cb.dataset.name;
            // Estructura: viajesPorHora es un array de 24 posiciones (0 a 23)
            summaryData[name] = { viajes: 0, totalKm: 0, totalMsRuta: 0, msBase: 0, msAero: 0, viajesPorHora: new Array(24).fill(0) };

            const [events, odoData] = await Promise.all([
                api.call("Get", { typeName: "ExceptionEvent", search: { deviceSearch: { id: deviceId }, fromDate, toDate }}),
                api.call("Get", { typeName: "StatusData", search: { 
                    deviceSearch: { id: deviceId }, 
                    diagnosticSearch: { id: "DiagnosticOdometerId" }, 
                    fromDate, toDate 
                }})
            ]);

            const ruleEvents = events
                .filter(e => e.rule && Object.values(ruleIDs).includes(e.rule.id))
                .sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));

            let lastEntrada = null;
            let lastSalida = null;

            for (let e of ruleEvents) {
                if (e.rule.id === ruleIDs.entradaBase || e.rule.id === ruleIDs.entradaAeropuerto) {
                    lastEntrada = e;
                    if (lastSalida) {
                        let tSalida = new Date(lastSalida.activeFrom);
                        let tLlegada = new Date(e.activeFrom);
                        let durMs = tLlegada - tSalida;
                        
                        let origenEsBase = lastSalida.rule.id === ruleIDs.salidaBase;
                        let destinoEsBase = e.rule.id === ruleIDs.entradaBase;

                        // Solo contamos viajes reales (Origen distinto de Destino)
                        if (durMs > 0 && origenEsBase !== destinoEsBase) {
                            const getOdo = (time) => {
                                const closest = odoData.reduce((prev, curr) => 
                                    Math.abs(new Date(curr.dateTime) - time) < Math.abs(new Date(prev.dateTime) - time) ? curr : prev
                                , odoData[0] || { data: 0 });
                                return closest.data / 1000; 
                            };

                            let odoIni = getOdo(tSalida);
                            let odoFin = getOdo(tLlegada);
                            let dist = Math.max(0, odoFin - odoIni);

                            if (dist === 0) dist = (durMs / 3600000) * 40; 

                            allRows.push({
                                fecha: tSalida.toLocaleDateString(),
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
                            
                            // Sumar un viaje en la hora correspondiente (ej. 14:30 suma en el índice 14)
                            summaryData[name].viajesPorHora[tSalida.getHours()]++;
                        }
                        lastSalida = null;
                    }
                }
                if (e.rule.id === ruleIDs.salidaBase || e.rule.id === ruleIDs.salidaAeropuerto) {
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
        let html = `<table id="tablaResumen"><thead><tr>
            <th>Vehículo</th><th>Viajes Tot.</th><th>Km Totales</th><th>Tiempo Tot. Conducción</th><th>Viajes/Día</th><th>Km/Día</th><th>Media Trayecto</th>
            <th>Permanencia Base/Día</th><th>Permanencia Aero/Día</th></tr></thead><tbody>`;
        
        let labels = [], vData = [], kData = [];
        let hourlyDatasets = [];
        let colorIndex = 0;

        Object.keys(data).forEach(name => {
            const d = data[name];
            if (d.viajes > 0) {
                let vDia = (d.viajes / days).toFixed(1);
                let kDia = (d.totalKm / days).toFixed(1);

                html += `<tr>
                    <td style="font-weight:bold; color:#2563eb">${name}</td>
                    <td>${d.viajes}</td>
                    <td>${d.totalKm.toFixed(1)} km</td>
                    <td>${msToTime(d.totalMsRuta)}</td>
                    <td>${vDia}</td>
                    <td>${kDia} km</td>
                    <td>${msToTime(d.totalMsRuta / d.viajes)}</td>
                    <td>${msToTime(d.msBase / days)}</td>
                    <td>${msToTime(d.msAero / days)}</td>
                </tr>`;
                
                labels.push(name);
                vData.push(vDia);
                kData.push(kDia);

                // CONFIGURACIÓN DEL GRÁFICO DE LÍNEAS POR HORAS
                hourlyDatasets.push({
                    label: name,
                    data: d.viajesPorHora,
                    borderColor: colorPalette[colorIndex % colorPalette.length],
                    backgroundColor: colorPalette[colorIndex % colorPalette.length] + '33', // Transparencia
                    borderWidth: 2,
                    tension: 0.3, // Líneas curvas
                    fill: false // Cambiado a false para que no se superpongan demasiado los rellenos
                });
                colorIndex++;
            }
        });
        document.getElementById("summaryTableContainer").innerHTML = html + "</tbody></table>";
        
        // Destruimos gráficos anteriores para evitar solapamientos
        if (chartViajes) chartViajes.destroy();
        if (chartKm) chartKm.destroy();
        if (chartHourly) chartHourly.destroy();

        // RENDERIZAR GRÁFICO POR HORAS
        const hoursLabels = Array.from({length: 24}, (_, i) => `${i}:00`);
        chartHourly = new Chart(document.getElementById('hourlyChart'), {
            type: 'line',
            data: { labels: hoursLabels, datasets: hourlyDatasets },
            options: {
                responsive: true,
                scales: { 
                    y: { 
                        beginAtZero: true, 
                        ticks: { stepSize: 1 },
                        title: { display: true, text: 'Nº de Viajes' }
                    },
                    x: {
                        title: { display: true, text: 'Hora del Día' }
                    }
                },
                plugins: { legend: { position: 'top' } }
            }
        });

        // Gráficos Diarios (Barras)
        chartViajes = new Chart(document.getElementById('viajesChart'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Viajes / Día', data: vData, backgroundColor: '#2563eb' }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
        chartKm = new Chart(document.getElementById('kmChart'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Km / Día', data: kData, backgroundColor: '#16a34a' }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    }

    function renderDetail(rows) {
        let html = `<table id="tablaDetalle"><thead><tr><th>Fecha</th><th>Hora Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Distancia</th></tr></thead><tbody>`;
        html += rows.map(r => `<tr><td>${r.fecha}</td><td>${r.hora}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.km} km</td></tr>`).join('');
        document.getElementById("tableContainer").innerHTML = html + "</tbody></table>";
    }

    // EXPORTACIÓN A EXCEL EN DOS PESTAÑAS
    function exportExcel() {
        if (typeof XLSX === 'undefined') return alert("Falta librería Excel.");
        
        const tableResumen = document.getElementById("tablaResumen");
        const tableDetalle = document.getElementById("tablaDetalle");
        
        if (!tableResumen || !tableDetalle) return alert("Genera el informe primero.");

        const wb = XLSX.utils.book_new();
        const wsResumen = XLSX.utils.table_to_sheet(tableResumen);
        const wsDetalle = XLSX.utils.table_to_sheet(tableDetalle);
        
        XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen Global");
        XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle Trayectos");
        
        XLSX.writeFile(wb, "Reporte_K10_Lanzaderas_Completo.xlsx");
    }
};
