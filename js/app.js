if ('serviceWorker' in navigator) {
    // Ruta absoluta desde la raíz del proyecto
    const swPath = './../sw.js';
    navigator.serviceWorker.register(swPath)
        .then(registration => {
            console.log('Service Worker registrado con éxito:', registration.scope);
        })
        .catch(error => {
            console.log('Error al registrar el Service Worker:', error);
        });
}
