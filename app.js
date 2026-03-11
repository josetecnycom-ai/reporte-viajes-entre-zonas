geotab.addin.reporteViajes = () => {
    return {
        initialize(api, state, callback) {
            // Configurar fechas por defecto: Hoy
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
            document.getElementById("dateFrom").value = start.toISOString().slice(0, 16);
            document.getElementById("dateTo").value = now.toISOString().slice(0, 16);

            // Cargar selectores dinámicos
            const fill = (id, items) => {
                const el = document.getElementById(id);
                el.innerHTML = "";
                items.sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach(i => {
                    el.add(new Option(i.name || i.description || i.id, i.id));
                });
            };

            Promise.all([
                api.call("Get", { typeName: "Group" }),
                api.call("Get", { typeName: "Device" }),
                api.call("Get", { typeName: "Zone" })
            ]).then(([groups, devices, zones]) => {
                fill("groupSelect", groups);
                fill("deviceSelect", devices);
                fill("zoneA", zones);
                fill("zoneB", zones);
                callback(); // Quita el spinner de carga
            }).catch(e => {
                console.error("Error en inicialización:", e);
                callback();
            });

            document.getElementById("btnGenerar").onclick = () => this.process(api);
            document.getElementById("btnExportar").onclick = () => this.export();
        },

        async process(api) {
            const container = document.getElementById("tableContainer");
            container.innerHTML = "Consultando datos en tiempo real...";

            const deviceOptions = Array.from(document.getElementById("deviceSelect").selectedOptions);
            const zAId = document.getElementById("zoneA").value;
            const zBId = document.getElementById("zoneB").value;
            const from = new Date(document.getElementById("dateFrom").value).toISOString();
            const to = new Date(document.getElementById("dateTo").value).toISOString();

            if (deviceOptions.length === 0) {
                alert("Selecciona al menos un vehículo");
                return;
            }

            try {
                let allRows = [];

                for (let opt of deviceOptions) {
                    const deviceId = opt.value;
                    const name = opt.text;

                    // Obtenemos eventos de zona para este vehículo
                    const events = await api.call("Get", {
                        typeName: "ExceptionEvent",
                        search: {
                            deviceSearch: { id: deviceId },
                            fromDate: from,
                            toDate: to,
                            ruleSearch: { id: "RuleZoneStopId" } // Regla estándar de paradas en zona
                        }
                    });

                    // Filtrar solo eventos que pertenezcan a las zonas A o B y ordenar por tiempo
                    const zoneEvents = events
                        .filter(e => e.zone && (e.zone.id === zAId || e.zone.id === zBId))
                        .sort((a, b) => new Date(a.activeFrom) - new Date(b.activeFrom));

                    // Lógica de emparejamiento para trayectos
                    for (let i = 0; i < zoneEvents.length - 1; i++) {
                        let actual = zoneEvents[i];
                        let siguiente = zoneEvents[i+1];

                        // Si sale de una zona y entra en la otra
                        if (actual.zone.id !== siguiente.zone.id) {
                            const salidaOrigen = new Date(actual.activeTo);
                            const llegadaDestino = new Date(siguiente.activeFrom);
                            
                            const trayectoMs = llegadaDestino - salidaOrigen;
                            const estanciaMs = new Date(actual.activeTo) - new Date(actual.activeFrom);

                            if (trayectoMs > 0) {
                                allRows.push({
                                    fecha: salidaOrigen.toLocaleDateString(),
                                    veh