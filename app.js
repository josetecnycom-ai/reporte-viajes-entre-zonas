geotab.addin.reporteViajes = function(api, state) {
    
    let chartInstance = null; // Para destruir el gráfico viejo si se genera otro

    const msToTime = (ms) => {
        if (ms < 0) return "0h 0m";
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
                // Configurar fechas
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                const todayStr = now.toISOString().slice(0, 16);
                
                document.getElementById("dateFrom").value = todayStr;
                document.getElementById("dateTo").value = todayStr;

                // Cerrar desplegable si se hace clic fuera
                document.addEventListener('click', function(e) {
                    const ms = document.getElementById('ms-devices');
                    if (!ms.contains(e.target)) ms.classList.remove('open');
                });

                api.call("Get", { typeName: "Device" }).then(function(devices) {
                    const optionsContainer = document.getElementById("deviceOptions");
                    const header = document.getElementById("deviceHeader");
                    
                    devices.sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(d => {
                        let lbl = document.createElement("label");
                        lbl.innerHTML = `<input type="checkbox" value="${d.id}" data-name="${d.name}"> ${d.name}`;
                        optionsContainer.appendChild(lbl);
                    });

                    // Actualizar texto del encabezado al seleccionar
                    optionsContainer.addEventListener('change', () => {
                        const checked = Array.from(optionsContainer.querySelectorAll('input:checked'));
                        if (checked.length === 0) header.innerText = "Seleccionar vehículos...";
                        else if (checked.length <= 2) header.innerText = checked.map(cb => cb.dataset.name).join(', ');
                        else header.innerText = `${checked.length} vehículos seleccionados`;
                    });

                    callback();
                }).catch(err => { console.error(err); callback(); });

                document.getElementById("btnGenerar").onclick = function() { processData(api); };
                document.getElementById("btnExportar").onclick = function() { exportExcel(); };

            } catch (error) { console.error("Error init:", error); callback(); }
        },
        focus: function(api, state) {},
        blur: function(api, state) {}
    };

    async function processData(api) {
        document.getElementById("loadingMsg").style.display = "block";
        document.getElementById("dashboardPanel").style.display = "none";
        document.getElementById("detailPanel").style.display = "none";

        try {
            const checkedBoxes = Array.from(document.querySelectorAll('#deviceOptions input:checked'));
            const fromDate = new Date(document.getElementById("dateFrom").value).toISOString();
            const toDate = new Date(document.getElementById("dateTo").value).toISOString();

            if (checkedBoxes.length === 0) {
                alert("Por favor, selecciona al menos un vehículo en el desplegable.");
                document.getElementById("loadingMsg").style.display = "none";
                return;
            }

            let allRows = [];
            let summaryData = {}; 
            const allRuleIds = Object.values(ruleIDs);

            for (let cb of checkedBoxes) {
                const deviceId = cb.value;
                const name = cb.dataset.name;

                // Inicializar datos del resumen para este vehículo
                summaryData[name] = { viajes: 0, totalMsTrayecto: 0, totalMsEstancia: 0, totalKm: 0 };

                // 1. Obtener Eventos (Entradas/Salidas)
                const events = await api.call("Get", {
                    typeName: "ExceptionEvent",
                    search: { deviceSearch: { id: deviceId }, fromDate: fromDate, toDate: toDate }
                });

                // 2. Obtener Viajes (Trips) para calcular Kilómetros
                const trips = await api.call("Get", {
                    typeName: "Trip",
                    search: { deviceSearch: { id: deviceId }, fromDate: fromDate, toDate: toDate }
                });

                const ruleEvents = events
                    .filter(e => e.rule && allRuleIds.includes(e.rule.id))
                    .sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));

                let lastEntradaTime = null;
                let estanciaMs = 0;
                let lastSalidaEvent = null;

                for (let e of ruleEvents) {
                    const isEntrada = (e.rule.id === ruleIDs.entradaAeropuerto || e.rule.id === ruleIDs.entradaBase);
                    const isSalida = (e.rule.id === ruleIDs.salidaAeropuerto || e.rule.id === ruleIDs.salidaBase);

                    if (isEntrada) {
                        lastEntradaTime = new Date(e.activeFrom);
                        
                        if (lastSalidaEvent) {
                            let salidaTime = new Date(lastSalidaEvent.activeFrom);
                            let llegadaTime = new Date(e.activeFrom);
                            let trayectoMs = llegadaTime - salidaTime;

                            let origenStr = lastSalidaEvent.rule.id === ruleIDs.salidaBase ? "Base K10" : "Aeropuerto";
                            let destinoStr = e.rule.id === ruleIDs.entradaBase ? "Base K10" : "Aeropuerto";

                            if (trayectoMs > 0 && origenStr !== destinoStr) {
                                // Calcular KM cruzando con los "Trips" de Geotab
                                let kmTrayecto = 0;
                                let overlappingTrips = trips.filter(t => new Date(t.start) <= llegadaTime && new Date(t.stop) >= salidaTime);
                                overlappingTrips.forEach(t => kmTrayecto += t.distance); // Geotab devuelve distancia en Km

                                allRows.push({
                                    fecha: salidaTime.toLocaleDateString(),
                                    horaSalida: salidaTime.toLocaleTimeString(),
                                    vehiculo: name,
                                    origen: origenStr,
                                    destino: destinoStr,
                                    duracion: msToTime(trayectoMs),
                                    km: kmTrayecto.toFixed(1),
                                    estancia: msToTime(estanciaMs)
                                });

                                // Sumar al Resumen
                                summaryData[name].viajes++;
                                summaryData[name].totalMsTrayecto += trayectoMs;
                                summaryData[name].totalMsEstancia += estanciaMs;
                                summaryData[name].totalKm += kmTrayecto;
                            }
                            lastSalidaEvent = null; 
                        }
                    }

                    if (isSalida) {
                        lastSalidaEvent = e;
                        if (lastEntradaTime) {
                            estanciaMs = new Date(e.activeFrom) - lastEntradaTime;
                            lastEntradaTime = null; 
                        } else estanciaMs = 0;
                    }
                }
            }
            
            document.getElementById("loadingMsg").style.display = "none";
            
            if(allRows.length > 0) {
                document.getElementById("dashboardPanel").style.display = "grid";
                document.getElementById("detailPanel").style.display = "block";
                renderSummaryAndChart(summaryData);
                renderDetailTable(allRows);
            } else {
                document.getElementById("tableContainer").innerHTML = `<p style="color:red;">No hay trayectos detectados en este rango de fechas.</p>`;
                document.getElementById("detailPanel").style.display = "block";
            }

        } catch (err) {
            document.getElementById("loadingMsg").style.display = "none";
            alert("Error al procesar: " + err.message);
        }
    }

    function renderSummaryAndChart(data) {
        let html = `<table>
            <thead><tr><th>Vehículo</th><th>Viajes Totales</th><th>Distancia (Km)</th><th>Media por Viaje</th><th>Estancia Media</th></tr></thead>
            <tbody>`;
        
        let chartLabels = [];
        let chartViajes = [];

        Object.keys(data).forEach(vehiculo => {
            let d = data[vehiculo];
            if (d.viajes > 0) {
                let mediaViajeMs = d.totalMsTrayecto / d.viajes;
                let mediaEstanciaMs = d.totalMsEstancia / d.viajes;
                
                html += `<tr>
                    <td><strong>${vehiculo}</strong></td>
                    <td>${d.viajes}</td>
                    <td>${d.totalKm.toFixed(1)} km</td>
                    <td>${msToTime(mediaViajeMs)}</td>
                    <td>${msToTime(mediaEstanciaMs)}</td>
                </tr>`;

                // Preparar datos para el gráfico
                chartLabels.push(vehiculo);
                chartViajes.push(d.viajes);
            }
        });
        html += `</tbody></table>`;
        document.getElementById("summaryTableContainer").innerHTML = html;

        // Renderizar Gráfico con Chart.js
        if (chartInstance) chartInstance.destroy(); // Destruir anterior si existe
        const ctx = document.getElementById('viajesChart').getContext('2d');
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: 'Nº de Viajes',
                    data: chartViajes,
                    backgroundColor: '#0056b3',
                    borderRadius: 4
                }]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        });
    }

    function renderDetailTable(rows) {
        let html = `
            <table id="tablaFinal">
                <thead>
                    <tr><th>Fecha</th><th>Hora Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Tiempo Ruta</th><th>Distancia</th><th>Estancia Previa</th></tr>
                </thead>
                <tbody>
                    ${rows.map(r => `<tr><td>${r.fecha}</td><td>${r.horaSalida}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.km} km</td><td>${r.estancia}</td></tr>`).join('')}
                </tbody>
            </table>`;
        document.getElementById("tableContainer").innerHTML = html;
    }

    function exportExcel() {
        const table = document.getElementById("tablaFinal");
        if (!table) return alert("Genera el informe primero.");
        if (typeof XLSX === 'undefined') return alert("Falta librería Excel.");
        const wb = XLSX.utils.table_to_book(table);
        XLSX.writeFile(wb, `Reporte_Lanzadera_K10.xlsx`);
    }
};