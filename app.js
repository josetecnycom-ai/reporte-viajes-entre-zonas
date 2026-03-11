geotab.addin.reporteViajes = (api, state) => {
    return {
        initialize(api, state, callback) {
            // 1. Cargar Grupos, Dispositivos y Zonas al iniciar
            Promise.all([
                api.call("Get", { typeName: "Group" }),
                api.call("Get", { typeName: "Device" }),
                api.call("Get", { typeName: "Zone" })
            ]).then(([groups, devices, zones]) => {
                fillSelect("groupSelect", groups);
                fillSelect("deviceSelect", devices);
                fillSelect("zoneStart", zones);
                fillSelect("zoneEnd", zones);
                callback();
            });
        },
        focus(api, state) {
            // Lógica cuando el usuario abre la pestaña
        },
        blur(api, state) {
            // Lógica cuando el usuario cierra la pestaña
        }
    };
};

// Función para calcular viajes (Lógica de emparejamiento)
async function calculateTrips(api, deviceId, startZoneId, endZoneId) {
    // Buscamos las excepciones de zona
    const exceptions = await api.call("Get", {
        typeName: "ExceptionEvent",
        search: {
            fromDate: document.getElementById("dateFrom").value,
            deviceSearch: { id: deviceId }
        }
    });
    
    // Aquí implementaremos la resta de tiempos:
    // (Llegada a Zona B) - (Salida de Zona A)
}