document.addEventListener("DOMContentLoaded", () => {

    const form = document.getElementById("loginForm");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    const API_URL = "http://localhost:8000/api/auth/login"

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            alert("Por favor complete todos los campos");
            return;
        }

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({username:username, password:password})
            })

            if (response.ok) {
                const data = await response.json();
                const token = data.token;

                if(token) {
                    localStorage.setItem("token", token);
                    localStorage.setItem("user", username);

                    const decodedToken = parseJwt(token);
                    const role = decodedToken.role;
                    localStorage.setItem("role", role);

                    alert("Inicio de sesión exitoso ¡Bienvenido!");

                    if(role === "ADMIN") {
                        window.location.href = "/modules/admin/dashboard.html";
                    } else if(role === "NURSE") {
                        window.location.href = "/modules/nurse/nurse-content.html";
                    } else {
                        window.location.href = "/index.html";
                    }
                } else {
                    alert("Credenciales incorrectas");
                }
            } else {
                alert("Usuario o contraseña incorrectos. Por favor intente nuevamente.");
            }
        } catch (error) {
            alert("Error de conexión con el servidor. Por favor intente nuevamente.");
            console.error("Error de conexión con el servidor:", error);
        }
        
    });
});

function parseJwt(token) {
    try {
        var base64Url = token.split('.')[1];
        var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('Error al decodificar el token:', error);
        return null;
    }
}
