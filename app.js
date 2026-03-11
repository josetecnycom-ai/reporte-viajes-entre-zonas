geotab.addin.reporteViajes = () => {
    let dataCache = [];

    return {
        initialize(api, state, callback) {
            const fillSelect = (id, items) => {
                const select = document.getElementById(id);
                if (!select) return;
                items.forEach(item => {
                    let opt = new Option(item.name || item.description, item.id);
                    select.add(opt);
                });
            };

            // Carga inicial de datos
            Promise.all([
                api.call("Get", { typeName: "Group" }),
                api.call("Get", { typeName: "Device" }),
                api.call("Get", { typeName: "Zone" })
            ]).then(([groups, devices, zones]) => {
                fillSelect("groupSelect", groups);
                fillSelect("deviceSelect", devices);
                fillSelect("zoneA", zones);
                fillSelect("zoneB", zones);
                
                // Set fechas por defecto (hoy)
                document.getElementById("dateFrom").valueAsDate = new Date();
                document.getElementById("dateTo").valueAsDate = new Date();
                
                callback();
            });

            document.getElementById("btnGenerar").addEventListener("click", () => {
                this.processData(api);
            });

            document.getElementById("btnExportar").addEventListener("click", () => {
                this.exportToExcel();
            });
        },

        async processData(api) {
            const selectedDevices = Array.from(document.getElementById("deviceSelect").selectedOptions).map(o => ({ id: o.value }));
            const zoneAId = document.getElementById("zoneA").value;
            const zoneBId = document.getElementById("zoneB").value;
            const fromDate = document.getElementById("dateFrom").value;
            const toDate = document.getElementById("dateTo").value;

            // Aquí llamaríamos a Get ExceptionEvent filtrando por zonaA y zonaB
            // Por brevedad, simulamos la lógica de cálculo que mostraremos en pantalla:
            
            let html = `<table class="results-table">
                <thead>
                    <tr>
                        <th>Fecha</th><th>Vehículo</th><th>Trayecto</th><th>Duración Viaje</th><th>Estancia en Zona</th>
                    </tr>
                </thead>
                <tbody>`;
            
            // Lógica de ejemplo (esto se poblará con los resultados reales del api.call)
            html += `<tr><td>${fromDate}</td><td>Furgoneta 1</td><td>A -> B</td><td>35 min</td><td>12 min</td></tr>`;
            html += `</tbody></table>`;
            
            document.getElementById("tableContainer").innerHTML = html;
        },

        exportToExcel() {
            const table = document.querySelector(".results-table");
            const wb = XLSX.utils.table_to_book(table);
            XLSX.writeFile(wb, `Reporte_Geotab_v1.1.0.xlsx`);
        }
    };
};