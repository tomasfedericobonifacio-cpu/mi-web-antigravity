// Importaciones de módulos (Versión Modular)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, deleteDoc, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// --- CONFIGURACIÓN FIREBASE (REEMPLAZA ESTO) ---
const firebaseConfig = {
    apiKey: "AIzaSyBhXDCRVgy3fVf24rYp2OtOpWiZhAIGsp8",
    authDomain: "ingresos-y-gastos-ecc5a.firebaseapp.com",
    projectId: "ingresos-y-gastos-ecc5a",
    storageBucket: "ingresos-y-gastos-ecc5a.firebasestorage.app",
    messagingSenderId: "230273541130",
    appId: "1:230273541130:web:7579d5e2c16ec2d98d6bf3",
    measurementId: "G-CMSFBGBPVR"
};

let app, auth, db;
let currentUser = null;
let unsubscribe = null; // Para cancelar la escucha en tiempo real

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    console.error("Error inicializando Firebase. Asegurate de configurar firebaseConfig correctamente.", e);
}

// --- Referencias DOM ---
const loginOverlay = document.getElementById('login-overlay');
const btnLogin = document.getElementById('btn-login');
const userAvatar = document.querySelector('.user-avatar');
const btnSettings = document.querySelector('button[title="Configuración"]'); // Usaremos este para Logout

// Variables Globales App
let transactions = [];
let chartInstance = null;
let currentType = 'expense';

// --- Autenticación ---

// Iniciar sesión
if (btnLogin) {
    btnLogin.addEventListener('click', () => {
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider)
            .then((result) => {
                // El observador onAuthStateChanged manejará el resto
                console.log("Logged in:", result.user.displayName);
            }).catch((error) => {
                console.error("Error login:", error);
                alert("Error al iniciar sesión: " + error.message);
            });
    });
}

// Cerrar sesión
if (btnSettings) {
    btnSettings.innerHTML = '<i class="ph ph-sign-out"></i>'; // Cambiar icono a salir
    btnSettings.title = "Cerrar Sesión";
    btnSettings.addEventListener('click', () => {
        if (currentUser) {
            signOut(auth).then(() => {
                console.log("Signed out");
            });
        }
    });
}

// Observador de estado de Auth
if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            loginOverlay.classList.add('hidden');

            // Actualizar avatar
            if (user.photoURL) {
                userAvatar.innerHTML = `<img src="${user.photoURL}" alt="User">`;
            } else {
                userAvatar.textContent = user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U';
            }

            // Cargar datos del usuario
            loadUserData(user.uid);

        } else {
            currentUser = null;
            loginOverlay.classList.remove('hidden');
            transactions = [];
            updateUI(); // Limpiar UI
            if (unsubscribe) unsubscribe(); // Dejar de escuchar cambios
        }
    });
}

// --- Firestore (Base de Datos) ---

function loadUserData(uid) {
    const q = query(
        collection(db, "transactions"),
        where("uid", "==", uid),
        orderBy("createdAt", "desc")
    );

    // Escucha en tiempo real
    unsubscribe = onSnapshot(q, (querySnapshot) => {
        const newTransactions = [];
        querySnapshot.forEach((doc) => {
            newTransactions.push({ id: doc.id, ...doc.data() });
        });

        transactions = newTransactions;
        updateUI(); // Actualizar toda la UI cuando cambian los datos
    }, (error) => {
        console.error("Error obteniendo documentos: ", error); // Posible error de permisos/reglas
        if (error.code === 'permission-denied') {
            alert("Error de permisos. Verifica las reglas de Firestore.");
        }
    });
}

async function addTransactionData(text, amount, category) {
    if (!currentUser) return;

    try {
        await addDoc(collection(db, "transactions"), {
            uid: currentUser.uid,
            text,
            amount,
            category,
            createdAt: serverTimestamp(), // Marca de tiempo del servidor para ordenar
            dateIso: new Date().toISOString() // Fecha local para filtrar en UI
        });
        // No necesitamos actualizar UI manualmente, onSnapshot lo hará
    } catch (e) {
        console.error("Error adding document: ", e);
        alert("Error guardando: " + e.message);
    }
}

async function removeTransactionData(id) {
    if (!currentUser) return;
    if (confirm('¿Eliminar transacción?')) {
        try {
            await deleteDoc(doc(db, "transactions", id));
        } catch (e) {
            console.error("Error removing document: ", e);
        }
    }
}

// --- App UI Logic (Adaptada) ---

const form = document.getElementById('transaction-form');
const listEl = document.getElementById('transaction-list');
const totalBalanceEl = document.getElementById('total-balance');
const totalIncomeEl = document.getElementById('total-income');
const totalExpenseEl = document.getElementById('total-expense');
const fileInput = document.getElementById('receipt-upload');
const ocrLoader = document.getElementById('ocr-loader');
const dropZone = document.getElementById('drop-zone');
const chartCanvas = document.getElementById('expensesChart');
const chartFilterEl = document.querySelector('.chart-filter');

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(amount);
};

function updateUI() {
    listEl.innerHTML = '';
    // transactions viene ordenado DESC (nuevo -> viejo) por la query de Firestore
    // Usamos appendChild para mantener ese orden (nuevo arriba si la query es correcta)

    transactions.forEach(t => {
        const sign = t.amount < 0 ? '-' : '+';
        const typeClass = t.amount < 0 ? 'expense' : 'income';

        const item = document.createElement('li');
        item.classList.add('transaction-item');

        const categoryIcons = {
            'comida': 'ph-hamburger', 'viandas': 'ph-lunchbox', 'servicios': 'ph-lightning',
            'ocio': 'ph-confetti', 'tarjeta': 'ph-credit-card', 'transporte': 'ph-bus',
            'salud': 'ph-first-aid', 'otros': 'ph-package'
        };
        const catIcon = categoryIcons[t.category] || 'ph-receipt';

        let dateStr = "Hoy";
        if (t.createdAt && t.createdAt.toDate) {
            dateStr = t.createdAt.toDate().toLocaleDateString();
        } else if (t.dateIso) {
            dateStr = new Date(t.dateIso).toLocaleDateString();
        }

        item.innerHTML = `
            <div class="t-info">
                <div class="t-icon ${typeClass}">
                    <i class="ph ${catIcon}"></i>
                </div>
                <div class="t-details">
                    <h4>${t.text}</h4>
                    <p>${dateStr} • ${t.category.charAt(0).toUpperCase() + t.category.slice(1)}</p>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="t-amount ${typeClass}">${sign}${formatCurrency(Math.abs(t.amount))}</span>
                <button class="btn-icon delete-btn" data-id="${t.id}">
                    <i class="ph ph-trash" style="font-size: 1rem; color: var(--danger);"></i>
                </button>
            </div>
        `;

        // Event listener directo
        item.querySelector('.delete-btn').addEventListener('click', () => {
            removeTransactionData(t.id);
        });

        listEl.appendChild(item);
    });

    updateValues();
    updateChart();
}

function updateValues() {
    const amounts = transactions.map(t => t.amount);
    const total = amounts.reduce((acc, item) => acc + item, 0).toFixed(2);

    const income = transactions
        .filter(t => t.amount > 0)
        .reduce((acc, t) => acc + t.amount, 0)
        .toFixed(2);

    const expense = (
        transactions
            .filter(t => t.amount < 0)
            .reduce((acc, t) => acc + t.amount, 0) * -1
    ).toFixed(2);

    totalBalanceEl.innerHTML = formatCurrency(total);
    totalIncomeEl.innerHTML = formatCurrency(income);
    totalExpenseEl.innerHTML = formatCurrency(expense);
}




// Formulario
document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentType = e.target.dataset.type;
    });
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = document.getElementById('description').value;
    const amountVal = +document.getElementById('amount').value;
    const category = document.getElementById('category').value;

    if (text.trim() === '' || amountVal === 0) {
        alert('Descripción y monto requeridos');
        return;
    }

    const finalAmount = currentType === 'expense' ? -Math.abs(amountVal) : Math.abs(amountVal);

    // Guardar en Firestore
    addTransactionData(text, finalAmount, category);

    form.reset();
    currentType = 'expense';
    document.querySelector('.type-btn[data-type="expense"]').click();
});

// Chart
chartFilterEl.addEventListener('change', updateChart);

function updateChart() {
    if (!transactions) return;

    const filterValue = chartFilterEl.value;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let filteredExpenses = transactions.filter(t => t.amount < 0);

    if (filterValue === 'Este Mes') {
        filteredExpenses = filteredExpenses.filter(t => {
            // Manejar timestamp de firestore o string ISO
            let d;
            if (t.createdAt && t.createdAt.toDate) d = t.createdAt.toDate();
            else if (t.dateIso) d = new Date(t.dateIso);
            else return true; // Si no hay fecha, incluir? O excluir.

            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });
    } else if (filterValue === 'Ultimos 3 Meses') {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(now.getMonth() - 2);
        filteredExpenses = filteredExpenses.filter(t => {
            let d;
            if (t.createdAt && t.createdAt.toDate) d = t.createdAt.toDate();
            else if (t.dateIso) d = new Date(t.dateIso);
            else return true;

            return d >= threeMonthsAgo;
        });
    }

    const categories = {};
    filteredExpenses.forEach(t => {
        if (categories[t.category]) categories[t.category] += Math.abs(t.amount);
        else categories[t.category] = Math.abs(t.amount);
    });

    const labels = Object.keys(categories).map(c => c.charAt(0).toUpperCase() + c.slice(1));
    const data = Object.values(categories);
    const bgColors = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#14b8a6'];

    if (chartInstance) chartInstance.destroy();

    // Si no hay datos, mostrar 'vacio' o mantener null
    if (data.length === 0 && chartInstance) { return; }

    const ctx = chartCanvas.getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 }, usePointStyle: true, padding: 20 }
                }
            },
            cutout: '75%',
        }
    });
}


// OCR Logic
const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});
dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        handleFileUpload({ target: { files: files } });
    }
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.querySelector('.upload-content').classList.add('hidden');
    ocrLoader.classList.remove('hidden');

    try {
        console.log("OCR Start");
        const worker = await Tesseract.createWorker('eng');
        const ret = await worker.recognize(file);
        const text = ret.data.text;

        const moneyRegex = /[$]?[0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{2})/g;
        const matches = text.match(moneyRegex);
        let maxVal = 0;

        if (matches) {
            matches.forEach(m => {
                let clean = m.replace(/[$,]/g, '');
                let val = parseFloat(clean);
                if (!isNaN(val) && val > maxVal) maxVal = val;
            });
        }

        if (maxVal > 0) {
            document.getElementById('amount').value = maxVal;
            document.getElementById('description').value = "Gasto Escaneado";
            document.getElementById('amount').focus();
        } else {
            alert("No se detectaron montos claros.");
        }
        await worker.terminate();

    } catch (error) {
        console.error(error);
        alert("Error al procesar imagen.");
    } finally {
        ocrLoader.classList.add('hidden');
        document.querySelector('.upload-content').classList.remove('hidden');
    }
}
