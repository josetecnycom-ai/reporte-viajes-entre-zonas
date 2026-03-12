geotab.addin.reporteViajes = function(api, state) {
    
    // Función auxiliar para convertir milisegundos a texto legible
    const msToTime = (ms) => {
        if (ms < 0) return "0h 0m 0s";
        let seconds = Math.floor((ms / 1000) % 60);
        let minutes = Math.floor((ms / (1000 * 60)) % 60);
        let hours = Math.floor((ms / (1000 * 60 * 60)));
        return `${hours}h ${minutes}m ${seconds}s`;
    };

    // TUS REGLAS EXACTAS DE GEOTAB
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
                
                const dateFromEl = document.getElementById("dateFrom");
                const dateToEl = document.getElementById("dateTo");
                if (dateFromEl) dateFromEl.value = todayStr;
                if (dateToEl) dateToEl.value = todayStr;

                // Llenar selectores (Ya no necesitamos las Zonas A y B porque usamos tus reglas directamente, pero los dejamos para no romper tu HTML)
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
        container.innerHTML = "<p>Analizando entradas y salidas... espere.</p>";

        try {
            const deviceSelect = document.getElementById("deviceSelect");
            const deviceOptions = Array.from(deviceSelect.selectedOptions);
            const fromDate = new Date(document.getElementById("dateFrom").value).toISOString();
            const toDate = new Date(document.getElementById("dateTo").value).toISOString();

            if (deviceOptions.length === 0) {
                container.innerHTML = "<p style='color:red;'>⚠️ Selecciona al menos un vehículo.</p>";
                return;
            }

            let allRows = [];
            const allRuleIds = Object.values(ruleIDs);

            for (let opt of deviceOptions) {
                const deviceId = opt.value;
                const name = opt.text;

                // Llamar a la API buscando excepciones
                const events = await api.call("Get", {
                    typeName: "ExceptionEvent",
                    search: {
                        deviceSearch: { id: deviceId },
                        fromDate: fromDate,
                        toDate: toDate
                    }
                });

                // Filtrar SOLO por las 4 reglas que has creado y ordenar cronológicamente
                const ruleEvents = events
                    .filter(e => e.rule && allRuleIds.includes(e.rule.id))
                    .sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));

                let lastEntradaTime = null;
                let estanciaMs = 0;
                let lastSalidaEvent = null;

                // Motor secuencial de búsqueda de trayectos
                for (let e of ruleEvents) {
                    const isEntrada = (e.rule.id === ruleIDs.entradaAeropuerto || e.rule.id === ruleIDs.entradaBase);
                    const isSalida = (e.rule.id === ruleIDs.salidaAeropuerto || e.rule.id === ruleIDs.salidaBase);

                    if (isEntrada) {
                        lastEntradaTime = new Date(e.activeFrom);
                        
                        // Si teníamos una salida pendiente, significa que acaba de llegar a su destino
                        if (lastSalidaEvent) {
                            let salidaTime = new Date(lastSalidaEvent.activeFrom);
                            let llegadaTime = new Date(e.activeFrom);
                            let trayectoMs = llegadaTime - salidaTime;

                            let origenStr = lastSalidaEvent.rule.id === ruleIDs.salidaBase ? "Base K10 Mobility" : "Aeropuerto";
                            let destinoStr = e.rule.id === ruleIDs.entradaBase ? "Base K10 Mobility" : "Aeropuerto";

                            // Solo registrar si realmente cambió de zona (evitar falsos positivos)
                            if (trayectoMs > 0 && origenStr !== destinoStr) {
                                allRows.push({
                                    fecha: salidaTime.toLocaleDateString(),
                                    horaSalida: salidaTime.toLocaleTimeString(),
                                    vehiculo: name,
                                    origen: origenStr,
                                    destino: destinoStr,
                                    duracion: msToTime(trayectoMs),
                                    estancia: msToTime(estanciaMs) // Tiempo que estuvo parado antes de salir
                                });
                            }
                            lastSalidaEvent = null; // Reiniciar para el próximo viaje
                        }
                    }

                    if (isSalida) {
                        lastSalidaEvent = e;
                        // Calcular cuánto tiempo estuvo en la zona si sabemos cuándo entró
                        if (lastEntradaTime) {
                            estanciaMs = new Date(e.activeFrom) - lastEntradaTime;
                            lastEntradaTime = null; 
                        } else {
                            estanciaMs = 0; // Salió, pero el evento de entrada fue antes de la fecha filtrada
                        }
                    }
                }
            }
            renderTable(allRows);
        } catch (err) {
            console.error("Error procesos:", err);
            container.innerHTML = `<p style="color:red;">Error al cargar datos: ${err.message}</p>`;
        }
    }

    function renderTable(rows) {
        if(rows.length === 0) {
            document.getElementById("tableContainer").innerHTML = `
                <div style="background:#fff3cd; color:#856404; padding:15px; border-radius:5px; border:1px solid #ffeeba;">
                    <strong>No hay trayectos detectados.</strong><br>
                    Asegúrate de que en las fechas seleccionadas los vehículos hayan generado las excepciones de "Entrada" y "Salida" en Geotab.
                </div>`;
            return;
        }
        let html = `
            <table class="results-table" id="tablaFinal">
                <thead>
                    <tr><th>Fecha</th><th>Hora Salida</th><th>Vehículo</th><th>Origen</th><th>Destino</th><th>Tiempo Ruta</th><th>Estancia Previa</th></tr>
                </thead>
                <tbody>
                    ${rows.map(r => `<tr><td>${r.fecha}</td><td>${r.horaSalida}</td><td>${r.vehiculo}</td><td>${r.origen}</td><td>${r.destino}</td><td>${r.duracion}</td><td>${r.estancia}</td></tr>`).join('')}
                </tbody>
            </table>`;
        document.getElementById("tableContainer").innerHTML = html;
    }

    function exportExcel() {
        const table = document.getElementById("tablaFinal");
        if (!table) return alert("Genera el informe primero para poder descargar.");
        if (typeof XLSX === 'undefined') return alert("Falta la librería Excel.");
        const wb = XLSX.utils.table_to_book(table);
        XLSX.writeFile(wb, `Reporte_Lanzadera_K10.xlsx`);
    }
}; // <-- Copiar hasta aquí