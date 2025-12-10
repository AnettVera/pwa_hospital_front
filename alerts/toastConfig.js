const Toast = {
    show: function(message, type, onAccept = null, onCancel = null) {
        const container = document.getElementById("toast-container");
        if (!container) {
            console.error("Contenedor de Toast no encontrado: #toast-container");
            return;
        }

        const toast = document.createElement("div");
        toast.classList.add("toast");

        switch(type){
            case "error":
                toast.classList.add("toast-error");
                break;
            case "success":
                toast.classList.add("toast-success");
                break;
            case "info":
                toast.classList.add("toast-info");
                break;
            case "modification":
                toast.classList.add("toast-modification");
                break;
            default:
                toast.classList.add("toast-info");
        }

        const msg = document.createElement("div");
        msg.classList.add("message");
        msg.innerText = message;

        const closeBtn = document.createElement("span");
        closeBtn.classList.add("close-btn");
        closeBtn.innerHTML = "&times;";
        closeBtn.onclick = () => {
             if (container.contains(toast)) container.removeChild(toast);
        }

        toast.appendChild(msg);
        toast.appendChild(closeBtn);

        if (type === "modification") {
            const btns = document.createElement("div");
            btns.classList.add("toast-buttons");

            const accept = document.createElement("button");
            accept.classList.add("accept-btn");
            accept.textContent = "Aceptar";
            accept.onclick = () => {
                if (onAccept) onAccept();
                if (container.contains(toast)) container.removeChild(toast);
            };

            const cancel = document.createElement("button");
            cancel.classList.add("cancel-btn");
            cancel.classList.add("me-1");
            cancel.textContent = "Cancelar";
            cancel.onclick = () => {
                if (onCancel) onCancel();
                if (container.contains(toast)) container.removeChild(toast);
            };

            btns.appendChild(accept);
            btns.appendChild(cancel);
            toast.appendChild(btns);
        }

        container.appendChild(toast);

        if (type !== "modification") {
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 3500);
        }
    }
};

window.Toast = Toast;