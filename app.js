geotab.addin.reporteViajes = function(api, state) {
    
    let chartViajes = null;
    let chartKm = null;

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
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                document.getElementById("dateFrom").value = now.toISOString().slice(0, 16);
                document.getElementById("dateTo").value = now.toISOString().slice(0, 16);

                document.addEventListener('click', (e) => {
                    const ms = document.getElementById('ms-devices');
                    if (ms && !ms.contains(e.target)) ms.classList.remove('open');
                });

                api.call("Get", { typeName: "Device" }).then(devices => {
                    const optionsContainer = document.getElementById("deviceOptions");
                    const header = document.getElementById("deviceHeader");
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
        const d1 = new Date(document.getElementById("dateFrom").value);
        const d2 = new Date(document.getElementById("dateTo").value);
        const fromDate = d1.toISOString();
        const toDate = d2.toISOString();
        
        // Calcular número de días en el rango (mínimo 1)
        const diffTime = Math.abs(d2 - d1);
        const numDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        if (checkedBoxes.length === 0) {
            alert("Selecciona al menos un vehículo.");
            document.getElementById("loadingMsg").style.display = "none";
            return;
        }

        let allRows = [];
        let summaryData = {}; 

        for (let cb of checkedBoxes) {
            const deviceId = cb.value;
            const name = cb.dataset.name;
            summaryData[name] = { 
                viajes: 0, totalKm: 0, totalMsRuta: 0, 
                msBase: 0, msAero: 0 
            };

            const [events, trips] = await Promise.all([
                api.call("Get", { typeName: "ExceptionEvent", search: { deviceSearch: { id: deviceId }, fromDate, toDate }}),
                api.call("Get", { typeName: "Trip", search: { deviceSearch: { id: deviceId }, fromDate, toDate }})
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
                        
                        if (durMs > 0) {
                            let dist = trips.filter(t => new Date(t.start) <= tLlegada && new Date(t.stop) >= tSalida)
                                            .reduce((acc, t) => acc + t.distance, 0);
                            
                            allRows.push({
                                fecha: tSalida.toLocaleDateString(),
                                vehiculo: name,
                                origen: lastSalida.rule.id === ruleIDs.salidaBase ? "Base" : "Aeropuerto",
                                destino: e.rule.id === ruleIDs.entradaBase ? "Base" : "Aeropuerto",
                                duracion: msToTime(durMs),
                                km: dist.toFixed(1)
                            });
                            summaryData[name].viajes++;
                            summaryData[name].totalKm += dist;
                            summaryData[name].totalMsRuta += durMs;
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
        document.getElementById("dashboardPanel").style.display = "block";
        document.getElementById("detailPanel").style.display = "block";
    }

    function renderDashboard(data, days) {
        let html = `<table><thead><tr>
            <th>Vehículo</th><th>Viajes/Día</th><th>Km/Día</th><th>Media Trayecto</th>
            <th>Permanencia Base/Día</th><th>Permanencia Aero/Día</th></tr></thead><tbody>`;
        
        let labels = [], vData = [], kData = [];

        Object.keys(data).forEach(name => {
            const d = data[name];
            if (d.viajes > 0) {
                html += `<tr>
                    <td class="highlight">${name}</td>
                    <td>${(d.viajes / days).toFixed(1)}</td>
                    <td>${(d.totalKm / days).toFixed(1)} km</td>
                    <td>${msToTime(d.totalMsRuta / d.viajes)}</td>
                    <td>${msToTime(d.msBase / days)}</td>
                    <td>${msToTime(d.msAero / days)}</td>
                </tr>`;
                labels.push(name);
                vData.push(d.viajes);
                kData.push(d.totalKm.toFixed(1));
            }
        });
        document.getElementById("summaryTableContainer").innerHTML = html + "</tbody></table>";
        
        if (chartViajes) chartViajes.destroy();
        if (chartKm) chartKm.destroy();

        chartViajes = new Chart(document.getElementById('viajesChart'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Viajes Totales', data: vData, backgroundColor: '#2563eb' }] },
            options: { plugins: { legend: { display: false } } }
        });
        chartKm = new Chart(document.getElementById('kmChart'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Km Totales', data: kData, backgroundColor: '#16a34a' }] },
            options: { plugins: { legend: { display: false } } }
        });
    }

    function renderDetail(rows) {
        let html = `<table><thead><tr><th>Fecha</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Duración</th><th>Distancia</th></tr></thead><tbody>`;
        html += rows.map(r => `<tr><td>${r.fecha}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.km} km</td></tr>`).join('');
        document.getElementById("tableContainer").innerHTML = html + "</tbody></table>";
    }

    function exportExcel() {
        const wb = XLSX.utils.table_to_book(document.getElementById("tableContainer"));
        XLSX.writeFile(wb, "Reporte_K10_Lanzaderas.xlsx");
    }
};