// Proteger la página ADMIN (solo se carga en admin.html)
if (!localStorage.getItem("token")) {
    window.location.href = "/index.html";
}

document.addEventListener("DOMContentLoaded", () => {
    const logoutBtn = document.querySelector(".logout");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.clear();
            window.location.href = "/index.html";
        });
    }
});
