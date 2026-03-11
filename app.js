geotab.addin.reporteViajes = () => {
    return {
        initialize(api, state, callback) {
            console.log("Inicializando Add-in de Trayectos...");

            // Función interna para llenar los selectores (la que faltaba)
            const fillSelect = (id, items) => {
                const select = document.getElementById(id);
                if (!select) return;
                select.innerHTML = ""; // Limpiar cargando...
                items.forEach(item => {
                    let option = document.createElement("option");
                    option.value = item.id;
                    option.text = item.name || item.description || item.id;
                    select.appendChild(option);
                });
            };

            // Llamadas a la API
            Promise.all([
                api.call("Get", { typeName: "Group" }),
                api.call("Get", { typeName: "Device" }),
                api.call("Get", { typeName: "Zone" })
            ]).then(([groups, devices, zones]) => {
                fillSelect("groupSelect", groups);
                fillSelect("deviceSelect", devices);
                fillSelect("zoneStart", zones);
                fillSelect("zoneEnd", zones);
                
                // IMPORTANTE: Esto quita el círculo de carga
                callback();
            }).catch(error => {
                console.error("Error cargando datos de Geotab:", error);
                callback(); // Cerramos el callback incluso si hay error para no bloquear
            });
        },
        focus(api, state) {
            console.log("Add-in en foco");
        },
        blur(api, state) {
            console.log("Add-in fuera de foco");
        }
    };
};