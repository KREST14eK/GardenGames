import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const CURRENCY_CODE = "ZEN";
const CURRENCY_NAME = "Зениты";
const INITIAL_BALANCE = 500;

const ADMIN_LOGINS = ["yash", "fazzertcity"];

const TASKS = [
  {
    id: "daily_check",
    title: "Ежедневная отметка",
    category: "Активность",
    reward: 25,
    description: "Зайти в систему и отметиться как активный участник."
  },
  {
    id: "help_member",
    title: "Помощь участнику",
    category: "Сообщество",
    reward: 75,
    description: "Помочь другому участнику разобраться с задачей или правилом."
  },
  {
    id: "event_play",
    title: "Участие в событии",
    category: "Ивент",
    reward: 120,
    description: "Принять участие в игровом событии и довести действие до результата."
  },
  {
    id: "report",
    title: "Короткий отчёт",
    category: "Контент",
    reward: 90,
    description: "Описать событие, ситуацию или результат в короткой форме."
  },
  {
    id: "discipline",
    title: "Бонус за дисциплину",
    category: "Репутация",
    reward: 60,
    description: "Получить отметку за соблюдение правил и нормальную коммуникацию."
  },
  {
    id: "special",
    title: "Спецзадание",
    category: "Особое",
    reward: 200,
    description: "Выполнить индивидуальное поручение администратора."
  }
];

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let activeView = "dashboardView";

function normalizeLogin(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function displayLogin(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function makeEmail(loginKey) {
  return `${loginKey}@zenmonk.local`;
}

function validateLogin(login) {
  return /^[a-zA-Z0-9_.-]{3,24}$/.test(login);
}

function isAdminLogin(loginKey) {
  return ADMIN_LOGINS.includes(loginKey);
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ${CURRENCY_CODE}`;
}

function roleName(role) {
  return role === "admin" ? "Администратор" : "Пользователь";
}

function now() {
  return Date.now();
}

function formatDate(value) {
  if (!value) return "только что";

  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(id, text, type = "") {
  const element = $(id);
  element.textContent = text || "";
  element.className = `message ${type}`.trim();
}

function friendlyError(error) {
  const code = error?.code || "";

  if (code === "auth/invalid-credential") return "Неверный логин или пароль.";
  if (code === "auth/email-already-in-use") return "Такой логин уже занят.";
  if (code === "auth/weak-password") return "Пароль должен быть минимум 6 символов.";
  if (code === "auth/unauthorized-domain") return "Домен сайта не добавлен в Firebase Authentication.";
  if (code === "PERMISSION_DENIED") return "Firebase запретил операцию. Проверь правила Realtime Database.";

  return error?.message || "Ошибка.";
}

function getAuthFields() {
  const originalLogin = displayLogin($("loginInput").value);
  const loginKey = normalizeLogin(originalLogin);
  const password = $("passwordInput").value;

  if (!originalLogin) throw new Error("Введите логин.");
  if (!validateLogin(originalLogin)) throw new Error("Логин: 3-24 символа, латиница, цифры, точка, дефис или подчёркивание.");
  if (!password || password.length < 6) throw new Error("Пароль должен быть минимум 6 символов.");

  return { originalLogin, loginKey, password };
}

async function register() {
  setMessage("authMessage", "Создаю аккаунт...");

  try {
    const { originalLogin, loginKey, password } = getAuthFields();
    const email = makeEmail(loginKey);

    const credential = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(credential.user, {
      displayName: originalLogin
    });

    const role = isAdminLogin(loginKey) ? "admin" : "user";

    await set(ref(db, `users/${credential.user.uid}`), {
      uid: credential.user.uid,
      username: originalLogin,
      loginKey,
      role,
      balance: INITIAL_BALANCE,
      createdAt: now(),
      updatedAt: now()
    });

    setMessage("authMessage", "Аккаунт создан.", "success");
  } catch (error) {
    setMessage("authMessage", friendlyError(error), "error");
  }
}

async function login() {
  setMessage("authMessage", "Вход...");

  try {
    const { loginKey, password } = getAuthFields();
    await signInWithEmailAndPassword(auth, makeEmail(loginKey), password);
    setMessage("authMessage", "");
  } catch (error) {
    setMessage("authMessage", friendlyError(error), "error");
  }
}

async function logout() {
  await signOut(auth);
}

async function ensureProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) return snapshot.val();

  const loginKey = normalizeLogin(user.email.split("@")[0]);
  const username = user.displayName || loginKey;
  const role = isAdminLogin(loginKey) ? "admin" : "user";

  const profile = {
    uid: user.uid,
    username,
    loginKey,
    role,
    balance: INITIAL_BALANCE,
    createdAt: now(),
    updatedAt: now()
  };

  await set(userRef, profile);
  return profile;
}

function showAuth() {
  currentUser = null;
  currentProfile = null;

  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
}

function renderShell() {
  if (!currentProfile) return;

  const admin = currentProfile.role === "admin";

  $("usernameText").textContent = currentProfile.username;
  $("uidText").textContent = currentUser.uid.slice(0, 8) + "...";
  $("roleText").textContent = roleName(currentProfile.role);

  $("balanceText").textContent = money(currentProfile.balance);
  $("dashLogin").textContent = currentProfile.username;
  $("dashRole").textContent = roleName(currentProfile.role);

  $("adminTab").classList.toggle("hidden", !admin);

  if (!admin && activeView === "adminView") {
    openView("dashboardView");
  }
}

function openView(viewId) {
  activeView = viewId;

  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active");
  });

  $(viewId).classList.add("active");
  loadView();
}

async function loadView() {
  if (!currentUser || !currentProfile) return;

  if (activeView === "dashboardView") await loadDashboard();
  if (activeView === "tasksView") await loadTasks();
  if (activeView === "historyView") await loadHistory();
  if (activeView === "leaderboardView") await loadLeaderboard();
  if (activeView === "adminView") await loadAdmin();
}

async function loadDashboard() {
  const requestsSnapshot = await get(ref(db, "taskRequests"));
  let count = 0;

  if (requestsSnapshot.exists()) {
    const requests = Object.values(requestsSnapshot.val());
    count = requests.filter((item) => item.userId === currentUser.uid).length;
  }

  $("dashRequests").textContent = count;
}

async function loadTasks() {
  const list = $("tasksList");
  list.innerHTML = `<div class="panel empty">Загрузка задач...</div>`;

  const snapshot = await get(ref(db, "taskRequests"));
  const pending = new Set();

  if (snapshot.exists()) {
    Object.values(snapshot.val()).forEach((request) => {
      if (request.userId === currentUser.uid && request.status === "pending") {
        pending.add(request.taskId);
      }
    });
  }

  list.innerHTML = TASKS.map((task) => {
    const isPending = pending.has(task.id);

    return `
      <article class="item-card">
        <div class="item-top">
          <div>
            <span class="pill">${escapeHtml(task.category)}</span>
            <h3>${escapeHtml(task.title)}</h3>
          </div>
          <span class="pill reward">+${task.reward} ${CURRENCY_CODE}</span>
        </div>
        <p>${escapeHtml(task.description)}</p>
        <button class="send-task-btn" data-task-id="${escapeHtml(task.id)}" ${isPending ? "disabled" : ""}>
          ${isPending ? "На проверке" : "Отправить на проверку"}
        </button>
      </article>
    `;
  }).join("");
}

async function sendTaskRequest(taskId) {
  const task = TASKS.find((item) => item.id === taskId);
  if (!task) return;

  const requestRef = push(ref(db, "taskRequests"));

  await set(requestRef, {
    id: requestRef.key,
    userId: currentUser.uid,
    username: currentProfile.username,
    taskId: task.id,
    taskTitle: task.title,
    reward: task.reward,
    status: "pending",
    createdAt: now(),
    updatedAt: now()
  });

  await loadTasks();
  await loadDashboard();
}

async function loadHistory() {
  const list = $("historyList");
  list.innerHTML = `<div class="panel empty">Загрузка истории...</div>`;

  const snapshot = await get(ref(db, "transactions"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="panel empty">Операций пока нет.</div>`;
    return;
  }

  let transactions = Object.values(snapshot.val());

  if (currentProfile.role !== "admin") {
    transactions = transactions.filter((item) => item.userId === currentUser.uid);
  }

  transactions.sort((a, b) => b.createdAt - a.createdAt);

  if (transactions.length === 0) {
    list.innerHTML = `<div class="panel empty">Операций пока нет.</div>`;
    return;
  }

  list.innerHTML = transactions.map((item) => {
    const typeClass = item.type === "debit" ? "debit" : "credit";
    const sign = item.type === "debit" ? "-" : "+";

    return `
      <article class="item-card">
        <div class="item-top">
          <div>
            <h3>${escapeHtml(item.reason || "Операция")}</h3>
            <p>${escapeHtml(formatDate(item.createdAt))}</p>
          </div>
          <span class="pill ${typeClass}">${sign}${money(item.amount)}</span>
        </div>
        <p>Пользователь: ${escapeHtml(item.username || "unknown")}</p>
        <p>Выполнил: ${escapeHtml(item.adminName || "system")}</p>
      </article>
    `;
  }).join("");
}

async function loadLeaderboard() {
  const list = $("leaderboardList");
  list.innerHTML = `<div class="panel empty">Загрузка рейтинга...</div>`;

  const snapshot = await get(ref(db, "users"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="panel empty">Пользователей пока нет.</div>`;
    return;
  }

  const users = Object.values(snapshot.val()).sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

  list.innerHTML = users.map((user, index) => {
    return `
      <article class="leader-row">
        <div class="rank">${index + 1}</div>
        <div>
          <h3>${escapeHtml(user.username)}</h3>
          <p>${escapeHtml(roleName(user.role))}</p>
        </div>
        <strong>${money(user.balance)}</strong>
      </article>
    `;
  }).join("");
}

async function loadAdmin() {
  const isAdmin = currentProfile.role === "admin";

  $("adminLocked").classList.toggle("hidden", isAdmin);
  $("adminPanel").classList.toggle("hidden", !isAdmin);

  if (!isAdmin) return;

  await loadAdminUsers();
  await loadTaskRequests();
}

async function loadAdminUsers() {
  const select = $("adminUserSelect");
  const list = $("adminUsersList");

  select.innerHTML = "";
  list.innerHTML = `<div class="empty">Загрузка...</div>`;

  const snapshot = await get(ref(db, "users"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="empty">Пользователей нет.</div>`;
    return;
  }

  const users = Object.values(snapshot.val()).sort((a, b) => {
    return String(a.username).localeCompare(String(b.username), "ru");
  });

  select.innerHTML = users.map((user) => {
    return `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.username)} - ${money(user.balance)}</option>`;
  }).join("");

  list.innerHTML = users.map((user) => {
    return `
      <div class="mini-user">
        <div>
          <strong>${escapeHtml(user.username)}</strong>
          <br>
          <span>${escapeHtml(roleName(user.role))}</span>
        </div>
        <strong>${money(user.balance)}</strong>
      </div>
    `;
  }).join("");
}

async function applyAdminOperation() {
  setMessage("adminMessage", "Выполняю операцию...");

  try {
    const uid = $("adminUserSelect").value;
    const operation = $("adminOperation").value;
    const amount = Number($("adminAmount").value);
    const reason = $("adminReason").value.trim();

    if (!uid) throw new Error("Выберите пользователя.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Введите корректную сумму.");
    if (!reason) throw new Error("Введите причину.");

    const userRef = ref(db, `users/${uid}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) throw new Error("Пользователь не найден.");

    const user = snapshot.val();
    const delta = operation === "credit" ? amount : -amount;
    const newBalance = Number(user.balance || 0) + delta;

    if (newBalance < 0) throw new Error("Баланс не может быть меньше нуля.");

    await update(userRef, {
      balance: newBalance,
      updatedAt: now()
    });

    const transactionRef = push(ref(db, "transactions"));

    await set(transactionRef, {
      id: transactionRef.key,
      userId: user.uid,
      username: user.username,
      type: operation,
      amount,
      delta,
      reason,
      adminId: currentUser.uid,
      adminName: currentProfile.username,
      balanceAfter: newBalance,
      createdAt: now()
    });

    $("adminAmount").value = "";
    $("adminReason").value = "";

    setMessage("adminMessage", "Операция выполнена.", "success");

    await loadAdmin();
    await loadLeaderboard();
  } catch (error) {
    setMessage("adminMessage", friendlyError(error), "error");
  }
}

async function loadTaskRequests() {
  const list = $("taskRequestsList");
  list.innerHTML = `<div class="empty">Загрузка заявок...</div>`;

  const snapshot = await get(ref(db, "taskRequests"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="empty">Заявок нет.</div>`;
    return;
  }

  const requests = Object.values(snapshot.val())
    .filter((item) => item.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);

  if (requests.length === 0) {
    list.innerHTML = `<div class="empty">Новых заявок нет.</div>`;
    return;
  }

  list.innerHTML = requests.map((request) => {
    return `
      <article class="item-card">
        <div class="item-top">
          <div>
            <span class="pill">${escapeHtml(request.username)}</span>
            <h3>${escapeHtml(request.taskTitle)}</h3>
          </div>
          <span class="pill reward">+${request.reward} ${CURRENCY_CODE}</span>
        </div>
        <p>Дата заявки: ${escapeHtml(formatDate(request.createdAt))}</p>
        <div class="actions">
          <button data-action="approve" data-id="${escapeHtml(request.id)}">Одобрить</button>
          <button class="danger" data-action="reject" data-id="${escapeHtml(request.id)}">Отклонить</button>
        </div>
      </article>
    `;
  }).join("");
}

async function approveRequest(requestId) {
  const requestRef = ref(db, `taskRequests/${requestId}`);
  const requestSnapshot = await get(requestRef);

  if (!requestSnapshot.exists()) return;

  const request = requestSnapshot.val();

  if (request.status !== "pending") return;

  const userRef = ref(db, `users/${request.userId}`);
  const userSnapshot = await get(userRef);

  if (!userSnapshot.exists()) return;

  const user = userSnapshot.val();
  const reward = Number(request.reward || 0);
  const newBalance = Number(user.balance || 0) + reward;

  await update(userRef, {
    balance: newBalance,
    updatedAt: now()
  });

  await update(requestRef, {
    status: "approved",
    reviewedBy: currentUser.uid,
    reviewedByName: currentProfile.username,
    reviewedAt: now(),
    updatedAt: now()
  });

  const transactionRef = push(ref(db, "transactions"));

  await set(transactionRef, {
    id: transactionRef.key,
    userId: user.uid,
    username: user.username,
    type: "credit",
    amount: reward,
    delta: reward,
    reason: `Задача: ${request.taskTitle}`,
    adminId: currentUser.uid,
    adminName: currentProfile.username,
    balanceAfter: newBalance,
    createdAt: now()
  });

  await loadAdmin();
  await loadLeaderboard();
}

async function rejectRequest(requestId) {
  await update(ref(db, `taskRequests/${requestId}`), {
    status: "rejected",
    reviewedBy: currentUser.uid,
    reviewedByName: currentProfile.username,
    reviewedAt: now(),
    updatedAt: now()
  });

  await loadAdmin();
}

function bindEvents() {
  $("loginBtn").addEventListener("click", login);
  $("registerBtn").addEventListener("click", register);
  $("logoutBtn").addEventListener("click", logout);

  $("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      openView(button.dataset.view);
    });
  });

  $("reloadTasksBtn").addEventListener("click", loadTasks);
  $("reloadHistoryBtn").addEventListener("click", loadHistory);
  $("reloadLeaderboardBtn").addEventListener("click", loadLeaderboard);
  $("reloadAdminBtn").addEventListener("click", loadAdmin);
  $("applyOperationBtn").addEventListener("click", applyAdminOperation);

  $("tasksList").addEventListener("click", (event) => {
    const button = event.target.closest(".send-task-btn");
    if (!button) return;

    sendTaskRequest(button.dataset.taskId);
  });

  $("taskRequestsList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "approve") approveRequest(id);
    if (action === "reject") rejectRequest(id);
  });
}

bindEvents();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showAuth();
    return;
  }

  currentUser = user;

  try {
    await ensureProfile(user);

    onValue(ref(db, `users/${user.uid}`), async (snapshot) => {
      if (!snapshot.exists()) return;

      currentProfile = snapshot.val();

      renderShell();
      showApp();
      await loadView();
    });
  } catch (error) {
    setMessage("authMessage", friendlyError(error), "error");
    showAuth();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}