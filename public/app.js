let TOKEN = localStorage.getItem('bank_token') || null;
let USER_DATA = null;
let PENDING_TRANSFER = null;

// DOM
const viewAuth      = document.getElementById('view-auth');
const viewDashboard = document.getElementById('view-dashboard');
const toast         = document.getElementById('toast');
const toastMsg      = document.getElementById('toast-msg');
const toastIcon     = document.getElementById('toast-icon');

const btnToggleAuth  = document.getElementById('btn-toggle-auth');
const authTitle      = document.getElementById('auth-title');
const authSubtitle   = document.getElementById('auth-subtitle');
const btnAuthSubmit  = document.getElementById('btn-auth-submit');
const btnAuthLabel   = document.getElementById('btn-auth-label');
const btnAuthSpinner = document.getElementById('btn-auth-spinner');
const toggleText     = document.getElementById('toggle-text');
const btnLogout      = document.getElementById('btn-logout');

const formAuth       = document.getElementById('form-auth');
const registroCampos = document.querySelectorAll('.id-registro');
const formTransfer   = document.getElementById('form-transfer');
const formAgenda     = document.getElementById('form-agenda');
const listAgenda     = document.getElementById('list-agenda');
const movementsList  = document.getElementById('movements-list');

const transferModal  = document.getElementById('transfer-modal');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalConfirm= document.getElementById('btn-modal-confirm');
const modalDest      = document.getElementById('modal-dest');
const modalAmount    = document.getElementById('modal-amount');
const modalConcept   = document.getElementById('modal-concept');
const modalConceptRow= document.getElementById('modal-concept-row');
const modalBtnLabel  = document.getElementById('modal-btn-label');
const modalSpinner   = document.getElementById('modal-spinner');

const btnShowPass    = document.getElementById('btn-show-pass');
const passInput      = document.getElementById('auth-password');

let esRegistro = false;
let toastTimeout = null;

// =========================================================================
// FILTROS DE ENTRADA EN TIEMPO REAL
// =========================================================================

// Nombre completo: solo letras, espacios, acentos y guiones
const authNameInput = document.getElementById('auth-name');
authNameInput.addEventListener('input', () => {
    const cursor = authNameInput.selectionStart;
    const cleaned = authNameInput.value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s'-]/g, '');
    if (authNameInput.value !== cleaned) {
        authNameInput.value = cleaned;
        authNameInput.setSelectionRange(cursor - 1, cursor - 1);
    }
});
authNameInput.addEventListener('keydown', (e) => {
    // Bloquear teclas numéricas del teclado principal y del numpad
    if ((e.key >= '0' && e.key <= '9') || (e.code >= 'Numpad0' && e.code <= 'Numpad9')) {
        e.preventDefault();
    }
});

// Monto de transferencia: solo números y un punto decimal, máximo 2 decimales
const transferAmountInput = document.getElementById('transfer-amount');
transferAmountInput.addEventListener('keydown', (e) => {
    const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
    if (allowed.includes(e.key)) return;
    // Permitir un solo punto decimal
    if (e.key === '.') {
        if (transferAmountInput.value.includes('.')) e.preventDefault();
        return;
    }
    // Solo dígitos
    if (!(e.key >= '0' && e.key <= '9') && !(e.code >= 'Numpad0' && e.code <= 'Numpad9')) {
        e.preventDefault();
    }
});
transferAmountInput.addEventListener('input', () => {
    let val = transferAmountInput.value;
    // Eliminar cualquier carácter que no sea dígito o punto
    val = val.replace(/[^0-9.]/g, '');
    // Conservar solo el primer punto
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    // Máximo 2 decimales
    if (parts[1]?.length > 2) val = parts[0] + '.' + parts[1].slice(0, 2);
    if (transferAmountInput.value !== val) transferAmountInput.value = val;
});

// =========================================================================
// TOAST
// =========================================================================
function mostrarAlerta(mensaje, esError = false) {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toast.classList.add('hiding');
        setTimeout(() => mostrarToastReal(mensaje, esError), 250);
    } else {
        mostrarToastReal(mensaje, esError);
    }
}
function mostrarToastReal(mensaje, esError) {
    toastMsg.textContent = mensaje;
    toastIcon.textContent = esError ? '✕' : '✓';
    toast.className = `toast ${esError ? 'toast-error' : 'toast-success'}`;
    toast.classList.remove('hidden', 'hiding');
    toastTimeout = setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            toast.classList.add('hidden');
            toastTimeout = null;
        }, 300);
    }, 4000);
}

// =========================================================================
// VER CONTRASEÑA
// =========================================================================
btnShowPass.addEventListener('click', () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
});

// =========================================================================
// TOGGLE LOGIN / REGISTRO
// =========================================================================
btnToggleAuth.addEventListener('click', (e) => {
    e.preventDefault();
    esRegistro = !esRegistro;
    if (esRegistro) {
        authTitle.textContent    = 'Crear cuenta nueva';
        authSubtitle.textContent = 'Llena los datos para empezar';
        btnAuthLabel.textContent = 'Crear mi cuenta';
        toggleText.textContent   = '¿Ya tienes cuenta?';
        btnToggleAuth.textContent= 'Inicia sesión aquí';
        registroCampos.forEach(el => el.classList.remove('hidden'));
        document.getElementById('auth-name').required = true;
    } else {
        authTitle.textContent    = 'Bienvenido de vuelta';
        authSubtitle.textContent = 'Inicia sesión para acceder a tu cuenta';
        btnAuthLabel.textContent = 'Ingresar a mi cuenta';
        toggleText.textContent   = '¿No tienes cuenta?';
        btnToggleAuth.textContent= 'Regístrate gratis';
        registroCampos.forEach(el => el.classList.add('hidden'));
        document.getElementById('auth-name').required = false;
    }
});

// =========================================================================
// AUTH: LOGIN / REGISTRO
// =========================================================================
formAuth.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name     = document.getElementById('auth-name').value.trim();

    setAuthLoading(true);

    const url      = esRegistro ? '/api/auth/register' : '/api/auth/login';
    const bodyData = esRegistro ? { name, email, password } : { email, password };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Error en la petición');

        if (esRegistro) {
            mostrarAlerta(`¡Cuenta creada! Tu número es: ${data.user.account_number}`);
            btnToggleAuth.click();
            formAuth.reset();
        } else {
            TOKEN = data.token;
            localStorage.setItem('bank_token', data.token);
            formAuth.reset();
            await cargarDashboard();
            await actualizarAgenda();
        }
    } catch (error) {
        mostrarAlerta(error.message, true);
    } finally {
        setAuthLoading(false);
    }
});

function setAuthLoading(loading) {
    btnAuthLabel.style.display   = loading ? 'none' : '';
    btnAuthSpinner.classList.toggle('hidden', !loading);
    btnAuthSubmit.disabled = loading;
}

// =========================================================================
// CARGAR DASHBOARD
// =========================================================================
async function cargarDashboard() {
    if (!TOKEN) return;

    try {
        const resUser = await fetch('/api/user/dashboard', {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const dataUser = await resUser.json();

        if (!resUser.ok) throw new Error(dataUser.error || 'Error de perfil');

        USER_DATA = dataUser.user;
        const saldo = parseFloat(USER_DATA.balance || 0);
        const nombre = USER_DATA.name || 'Usuario';
        const iniciales = nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

        document.getElementById('nav-username').textContent = nombre.split(' ')[0];
        document.getElementById('nav-avatar').textContent   = iniciales;
        document.getElementById('user-account').textContent = USER_DATA.account_number || '0000000000';

        animarSaldo(saldo);

        viewAuth.classList.add('hidden');
        viewDashboard.classList.remove('hidden');

    } catch (error) {
        mostrarAlerta('Error al sincronizar perfil.', true);
        logout();
        return;
    }

    await cargarMovimientos();
}

// Animación de contador del saldo
function animarSaldo(targetValue) {
    const el      = document.getElementById('user-balance');
    const current = parseFloat(el.textContent.replace(/,/g, '')) || 0;
    const duration = 800;
    const start   = performance.now();

    function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const ease     = 1 - Math.pow(1 - progress, 3);
        const value    = current + (targetValue - current) * ease;
        el.textContent = value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// =========================================================================
// CARGAR MOVIMIENTOS
// =========================================================================
async function cargarMovimientos() {
    const rango = document.getElementById('filter-time')?.value || 'todos';

    try {
        const res  = await fetch(`/api/user/movements?rango=${rango}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const data = await res.json();

        movementsList.innerHTML = '';

        if (!res.ok || !data.movements || data.movements.length === 0) {
            movementsList.innerHTML = `
                <div class="movements-empty">
                    <svg width="40" height="40" viewBox="0 0 20 20" fill="none" opacity="0.25">
                        <path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 5.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 11H12a1 1 0 100-2H8.414l1.293-1.293z" clip-rule="evenodd" fill="currentColor"/>
                    </svg>
                    <p>No hay movimientos en este período</p>
                </div>`;
            return;
        }

        data.movements.forEach((mov, i) => {
            const esCargo = mov.source_account === USER_DATA.account_number;
            const fecha   = new Date(mov.created_at).toLocaleString('es-MX', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
            });
            const monto = parseFloat(mov.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 });
            const tercero = esCargo
                ? `→ ${mov.destination_account}`
                : `← ${mov.source_account}`;

            const item = document.createElement('div');
            item.className = 'movement-item';
            item.style.animationDelay = `${i * 30}ms`;

            item.innerHTML = `
                <div class="movement-icon ${esCargo ? 'debit' : 'credit'}">
                    ${esCargo
                        ? `<svg viewBox="0 0 20 20" fill="none"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" fill="currentColor"/></svg>`
                        : `<svg viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clip-rule="evenodd" fill="currentColor"/></svg>`
                    }
                </div>
                <div class="movement-info">
                    <div class="movement-concept">${mov.concept || 'Transferencia'}</div>
                    <div class="movement-meta">${tercero} · ${fecha}</div>
                </div>
                <div class="movement-amount ${esCargo ? 'debit' : 'credit'}">
                    ${esCargo ? '-' : '+'}$${monto}
                </div>`;

            movementsList.appendChild(item);
        });

    } catch (error) {
        movementsList.innerHTML = `<div class="movements-empty"><p>Error al cargar movimientos</p></div>`;
    }
}

// =========================================================================
// TRANSFERENCIA — MODAL DE CONFIRMACIÓN
// =========================================================================
formTransfer.addEventListener('submit', (e) => {
    e.preventDefault();

    const target_account = document.getElementById('transfer-target').value.trim();
    const amount         = document.getElementById('transfer-amount').value;
    const concept        = document.getElementById('transfer-concept').value.trim();

    PENDING_TRANSFER = { target_account, amount, concept };

    modalDest.textContent   = target_account;
    modalAmount.textContent = `$${parseFloat(amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;

    if (concept) {
        modalConcept.textContent = concept;
        modalConceptRow.style.display = '';
    } else {
        modalConceptRow.style.display = 'none';
    }

    transferModal.classList.remove('hidden');
});

btnModalCancel.addEventListener('click', () => {
    transferModal.classList.add('hidden');
    PENDING_TRANSFER = null;
});

transferModal.addEventListener('click', (e) => {
    if (e.target === transferModal) {
        transferModal.classList.add('hidden');
        PENDING_TRANSFER = null;
    }
});

btnModalConfirm.addEventListener('click', async () => {
    if (!PENDING_TRANSFER) return;

    setModalLoading(true);

    const { target_account, amount, concept } = PENDING_TRANSFER;

    try {
        const response = await fetch('/api/transactions/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ target_account, amount, concept })
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error);

        transferModal.classList.add('hidden');
        PENDING_TRANSFER = null;
        mostrarAlerta(data.message);
        formTransfer.reset();
        await cargarDashboard();
        await cargarMovimientos();

    } catch (error) {
        mostrarAlerta(error.message, true);
        transferModal.classList.add('hidden');
    } finally {
        setModalLoading(false);
    }
});

function setModalLoading(loading) {
    modalBtnLabel.style.display = loading ? 'none' : '';
    modalSpinner.classList.toggle('hidden', !loading);
    btnModalConfirm.disabled = loading;
    btnModalCancel.disabled  = loading;
}

// =========================================================================
// AGENDA
// =========================================================================
formAgenda.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alias               = document.getElementById('agenda-alias').value.trim();
    const target_account_number = document.getElementById('agenda-account').value.trim();

    try {
        const res  = await fetch('/api/user/agenda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
            body: JSON.stringify({ alias, target_account_number })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        mostrarAlerta(data.message);
        formAgenda.reset();
        await actualizarAgenda();
    } catch (error) {
        mostrarAlerta(error.message, true);
    }
});

async function actualizarAgenda() {
    if (!listAgenda || !TOKEN) return;

    try {
        const res  = await fetch('/api/user/agenda', {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const data = await res.json();

        listAgenda.innerHTML = '';

        if (!data.agenda || data.agenda.length === 0) {
            listAgenda.innerHTML = `
                <li class="agenda-empty">
                    <svg width="32" height="32" viewBox="0 0 20 20" fill="none" opacity="0.3">
                        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" fill="currentColor"/>
                    </svg>
                    <p>No tienes contactos guardados</p>
                </li>`;
            return;
        }

        data.agenda.forEach((contacto, i) => {
            const iniciales = contacto.alias.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
            const li = document.createElement('li');
            li.className = 'agenda-item';
            li.style.animationDelay = `${i * 40}ms`;

            li.innerHTML = `
                <div class="agenda-item-info clickable-info" data-account="${contacto.target_account_number}" data-alias="${contacto.alias}">
                    <div class="agenda-avatar">${iniciales}</div>
                    <div>
                        <div class="agenda-name">${contacto.alias}</div>
                        <div class="agenda-account">${contacto.target_account_number}</div>
                    </div>
                </div>
                <div class="agenda-actions">
                    <button class="agenda-btn agenda-btn-edit btn-edit-contact" data-id="${contacto.id}" data-alias="${contacto.alias}" title="Editar alias" aria-label="Editar alias">
                        <svg viewBox="0 0 20 20" fill="none"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" fill="currentColor"/></svg>
                    </button>
                    <button class="agenda-btn agenda-btn-delete btn-delete-contact" data-id="${contacto.id}" title="Eliminar contacto" aria-label="Eliminar contacto">
                        <svg viewBox="0 0 20 20" fill="none"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm-1 6a1 1 0 012 0v5a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v5a1 1 0 11-2 0V8z" clip-rule="evenodd" fill="currentColor"/></svg>
                    </button>
                </div>`;

            listAgenda.appendChild(li);
        });

        // Selección rápida
        listAgenda.querySelectorAll('.clickable-info').forEach(el => {
            el.addEventListener('click', () => {
                const cuenta = el.getAttribute('data-account');
                const nombre = el.getAttribute('data-alias');
                document.getElementById('transfer-target').value = cuenta;
                document.getElementById('transfer-target').focus();
                mostrarAlerta(`Contacto seleccionado: ${nombre}`);
            });
        });

        // Borrar contacto
        listAgenda.querySelectorAll('.btn-delete-contact').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('¿Eliminar este contacto de la agenda?')) return;
                const id = btn.getAttribute('data-id');
                try {
                    const res  = await fetch(`/api/user/agenda/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${TOKEN}` }
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    mostrarAlerta(data.message);
                    await actualizarAgenda();
                } catch (err) {
                    mostrarAlerta(err.message, true);
                }
            });
        });

        // Editar alias
        listAgenda.querySelectorAll('.btn-edit-contact').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id          = btn.getAttribute('data-id');
                const aliasActual = btn.getAttribute('data-alias');
                const nuevoAlias  = prompt('Nuevo nombre para el contacto:', aliasActual);
                if (nuevoAlias === null) return;
                if (!nuevoAlias.trim()) return mostrarAlerta('El nombre no puede estar vacío', true);

                try {
                    const res  = await fetch(`/api/user/agenda/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
                        body: JSON.stringify({ nuevoAlias })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    mostrarAlerta(data.message);
                    await actualizarAgenda();
                } catch (err) {
                    mostrarAlerta(err.message, true);
                }
            });
        });

    } catch (error) {
        console.error('Error agenda:', error);
    }
}

// =========================================================================
// FILTRO DE MOVIMIENTOS
// =========================================================================
document.getElementById('filter-time').addEventListener('change', async () => {
    await cargarMovimientos();
});

// =========================================================================
// LOGOUT
// =========================================================================
function logout() {
    TOKEN     = null;
    USER_DATA = null;
    PENDING_TRANSFER = null;
    localStorage.removeItem('bank_token');
    viewDashboard.classList.add('hidden');
    viewAuth.classList.remove('hidden');
}
btnLogout.addEventListener('click', logout);

// =========================================================================
// PERSISTENCIA DE SESIÓN
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    if (TOKEN) {
        await cargarDashboard();
        await actualizarAgenda();
    }
});
