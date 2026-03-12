geotab.addin.reporteViajes = function(api, state) {
    
    // Función auxiliar para convertir milisegundos a texto
    const msToTime = (ms) => {
        let seconds = Math.floor((ms / 1000) % 60);
        let minutes = Math.floor((ms / (1000 * 60)) % 60);
        let hours = Math.floor((ms / (1000 * 60 * 60)));
        return `${hours}h ${minutes}m ${seconds}s`;
    };

    return {
        initialize: function(api, state, callback) {
            try {
                // Configurar fechas
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                const todayStr = now.toISOString().slice(0, 16);
                
                const dateFromEl = document.getElementById("dateFrom");
                const dateToEl = document.getElementById("dateTo");
                if (dateFromEl) dateFromEl.value = todayStr;
                if (dateToEl) dateToEl.value = todayStr;

                // Llenar selectores
                const fill = (id, items) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.innerHTML = "";
                    items.sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(i => {
                        let opt = document.createElement('option');
                        opt.value = i.id;
                        opt.text = i.name || i.description || i.id;
                        el.appendChild(opt);
                    });
                };

                Promise.all([
                    api.call("Get", { typeName: "Group" }),
                    api.call("Get", { typeName: "Device" }),
                    api.call("Get", { typeName: "Zone" })
                ]).then(function(results) {
                    fill("groupSelect", results[0]);
                    fill("deviceSelect", results[1]);
                    fill("zoneA", results[2]);
                    fill("zoneB", results[2]);
                    
                    document.getElementById("btnGenerar").onclick = function() { processData(api); };
                    document.getElementById("btnExportar").onclick = function() { exportExcel(); };
                    
                    callback();
                }).catch(function(err) {
                    console.error("Error API:", err);
                    callback();
                });

            } catch (error) {
                console.error("Error init:", error);
                callback();
            }
        },
        focus: function(api, state) {},
        blur: function(api, state) {}
    };

    async function processData(api) {
        const container = document.getElementById("tableContainer");
        container.innerHTML = "<p>Consultando datos... espere.</p>";

        try {
            const deviceSelect = document.getElementById("deviceSelect");
            const deviceOptions = Array.from(deviceSelect.selectedOptions);
            const zAId = document.getElementById("zoneA").value;
            const zBId = document.getElementById("zoneB").value;
            
            const fromDate = new Date(document.getElementById("dateFrom").value).toISOString();
            const toDate = new Date(document.getElementById("dateTo").value).toISOString();

            if (deviceOptions.length === 0) {
                container.innerHTML = "<p style='color:red;'>⚠️ Selecciona un vehículo.</p>";
                return;
            }

            let allRows = [];

            for (let opt of deviceOptions) {
                const deviceId = opt.value;
                const name = opt.text;

                const events = await api.call("Get", {
                    typeName: "ExceptionEvent",
                    search: {
                        deviceSearch: { id: deviceId },
                        fromDate: fromDate,
                        toDate: toDate
                    }
                });

                const zoneEvents = events
                    .filter(e => e.zone && (e.zone.id === zAId || e.zone.id === zBId))
                    .sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));

                for (let i = 0; i < zoneEvents.length - 1; i++) {
                    let actual = zoneEvents[i];
                    let siguiente = zoneEvents[i+1];

                    if (actual.zone.id !== siguiente.zone.id) {
                        const salidaOrigen = new Date(actual.activeTo);
                        const llegadaDestino = new Date(siguiente.activeFrom);
                        const trayectoMs = llegadaDestino - salidaOrigen;
                        const estanciaMs = new Date(actual.activeTo) - new Date(actual.activeFrom);

                        if (trayectoMs > 0) {
                            allRows.push({
                                fecha: salidaOrigen.toLocaleDateString(),
                                horaSalida: salidaOrigen.toLocaleTimeString(),
                                vehiculo: name,
                                origen: actual.zone.id === zAId ? "Zona A" : "Zona B",
                                destino: siguiente.zone.id === zAId ? "Zona A" : "Zona B",
                                duracion: msToTime(trayectoMs),
                                estancia: msToTime(estanciaMs)
                            });
                        }
                    }
                }
            }
            renderTable(allRows);
        } catch (err) {
            console.error("Error procesos:", err);
            container.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
        }
    }

    function renderTable(rows) {
        if(rows.length === 0) {
            document.getElementById("tableContainer").innerHTML = "<p>No hay trayectos.</p>";
            return;
        }
        let html = `
            <table class="results-table" id="tablaFinal">
                <thead>
                    <tr><th>Fecha</th><th>Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Tiempo Ruta</th><th>Estancia</th></tr>
                </thead>
                <tbody>
                    ${rows.map(r => `<tr><td>${r.fecha}</td><td>${r.horaSalida}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.estancia}</td></tr>`).join('')}
                </tbody>
            </table>`;
        document.getElementById("tableContainer").innerHTML = html;
    }

    function exportExcel() {
        const table = document.getElementById("tablaFinal");
        if (!table) return alert("Genera el informe primero.");
        if (typeof XLSX === 'undefined') return alert("Falta librería Excel.");
        const wb = XLSX.utils.table_to_book(table);
        XLSX.writeFile(wb, `Reporte_Lanzadera.xlsx`);
    }
}; // <-- ¡Asegúrate de copiar hasta aquí!