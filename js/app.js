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
const INITIAL_BALANCE = 0;
const ADMIN_LOGINS = ["yash", "fazzertcity"];

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
  const code = error?.code || error?.message || "";

  if (code.includes("auth/invalid-credential")) return "Неверный логин или пароль.";
  if (code.includes("auth/email-already-in-use")) return "Такой логин уже занят.";
  if (code.includes("auth/weak-password")) return "Пароль должен быть минимум 6 символов.";
  if (code.includes("auth/unauthorized-domain")) return "Домен сайта не добавлен в Firebase Authentication.";
  if (code.includes("PERMISSION_DENIED")) return "Firebase запретил операцию. Проверь правила Realtime Database.";

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
    const credential = await createUserWithEmailAndPassword(auth, makeEmail(loginKey), password);

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
  $("tasksTab").classList.toggle("hidden", admin);

  if (admin && activeView === "tasksView") openView("dashboardView");
  if (!admin && activeView === "adminView") openView("dashboardView");
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
  const snapshot = await get(ref(db, "tasks"));
  let count = 0;

  if (snapshot.exists()) {
    const tasks = Object.values(snapshot.val());

    if (currentProfile.role === "admin") {
      count = tasks.length;
    } else {
      count = tasks.filter((task) => task.assignedTo === currentUser.uid).length;
    }
  }

  $("dashTasks").textContent = count;
}

async function loadTasks() {
  const list = $("tasksList");
  list.innerHTML = `<div class="panel empty">Загрузка задач...</div>`;

  const snapshot = await get(ref(db, "tasks"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="panel empty">У тебя пока нет задач.</div>`;
    return;
  }

  const tasks = Object.values(snapshot.val())
    .filter((task) => task.assignedTo === currentUser.uid)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (tasks.length === 0) {
    list.innerHTML = `<div class="panel empty">У тебя пока нет задач.</div>`;
    return;
  }

  list.innerHTML = tasks.map(renderUserTaskCard).join("");
}

function renderUserTaskCard(task) {
  const canSubmit = task.status === "active";
  const statusText = getTaskStatusText(task.status);

  return `
    <article class="item-card">
      <div class="item-top">
        <div>
          <span class="pill ${escapeHtml(task.status)}">${escapeHtml(statusText)}</span>
          <h3>${escapeHtml(task.title)}</h3>
        </div>
        <span class="pill reward">+${Number(task.reward || 0)} ${CURRENCY_CODE}</span>
      </div>

      <p>${escapeHtml(task.description || "Без описания")}</p>
      <p>Создал: ${escapeHtml(task.createdByName || "admin")}</p>
      <p>Дата: ${escapeHtml(formatDate(task.createdAt))}</p>

      <button class="submit-task-btn" data-id="${escapeHtml(task.id)}" ${canSubmit ? "" : "disabled"}>
        ${canSubmit ? "Отправить на проверку" : statusText}
      </button>
    </article>
  `;
}

function getTaskStatusText(status) {
  if (status === "active") return "Активна";
  if (status === "review") return "На проверке";
  if (status === "approved") return "Одобрена";
  if (status === "rejected") return "Отклонена";
  return "Неизвестно";
}

async function submitTask(taskId) {
  const taskRef = ref(db, `tasks/${taskId}`);
  const snapshot = await get(taskRef);

  if (!snapshot.exists()) return;

  const task = snapshot.val();

  if (task.assignedTo !== currentUser.uid || task.status !== "active") return;

  await update(taskRef, {
    status: "review",
    submittedAt: now(),
    updatedAt: now()
  });

  await loadTasks();
  await loadDashboard();
}

async function loadHistory() {
  const list = $("historyList");
  list.innerHTML = `<div class="panel empty">Загрузка истории...</div>`;

  const snapshot = await get(ref(db, "transactionsByUser"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="panel empty">История пока пустая.</div>`;
    return;
  }

  const allHistory = snapshot.val();

  if (currentProfile.role !== "admin") {
    const userHistory = allHistory[currentProfile.loginKey] || {};
    const rows = Object.values(userHistory).sort((a, b) => b.createdAt - a.createdAt);

    if (rows.length === 0) {
      list.innerHTML = `<div class="panel empty">История пока пустая.</div>`;
      return;
    }

    list.innerHTML = rows.map(renderTransaction).join("");
    return;
  }

  const folders = Object.entries(allHistory).sort(([a], [b]) => a.localeCompare(b, "ru"));

  list.innerHTML = folders.map(([loginKey, items]) => {
    const rows = Object.values(items).sort((a, b) => b.createdAt - a.createdAt);

    return `
      <details class="folder-card" open>
        <summary>${escapeHtml(loginKey)} - ${rows.length} операций</summary>
        <div class="folder-content">
          ${rows.map(renderTransaction).join("")}
        </div>
      </details>
    `;
  }).join("");
}

function renderTransaction(item) {
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
  const admin = currentProfile.role === "admin";

  $("adminLocked").classList.toggle("hidden", admin);
  $("adminPanel").classList.toggle("hidden", !admin);

  if (!admin) return;

  await loadAdminUsers();
  await loadReviewTasks();
  await loadAdminTasksByUsers();
}

async function getUsers() {
  const snapshot = await get(ref(db, "users"));

  if (!snapshot.exists()) return [];

  return Object.values(snapshot.val()).sort((a, b) => {
    return String(a.username).localeCompare(String(b.username), "ru");
  });
}

async function loadAdminUsers() {
  const users = await getUsers();

  const adminSelect = $("adminUserSelect");
  const taskSelect = $("taskUserSelect");
  const list = $("adminUsersList");

  adminSelect.innerHTML = users.map((user) => {
    return `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.username)} - ${money(user.balance)}</option>`;
  }).join("");

  taskSelect.innerHTML = users
    .filter((user) => user.role !== "admin")
    .map((user) => {
      return `<option value="${escapeHtml(user.uid)}">${escapeHtml(user.username)}</option>`;
    })
    .join("");

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

    await createTransaction(user, operation, amount, delta, reason, newBalance);

    $("adminAmount").value = "";
    $("adminReason").value = "";

    setMessage("adminMessage", "Операция выполнена.", "success");

    await loadAdmin();
    await loadLeaderboard();
  } catch (error) {
    setMessage("adminMessage", friendlyError(error), "error");
  }
}

async function createTransaction(user, type, amount, delta, reason, balanceAfter) {
  const transactionRef = push(ref(db, `transactionsByUser/${user.loginKey}`));

  await set(transactionRef, {
    id: transactionRef.key,
    userId: user.uid,
    username: user.username,
    loginKey: user.loginKey,
    type,
    amount,
    delta,
    reason,
    adminId: currentUser.uid,
    adminName: currentProfile.username,
    balanceAfter,
    createdAt: now()
  });
}

async function createTask() {
  setMessage("taskCreateMessage", "Создаю задачу...");

  try {
    const assignedTo = $("taskUserSelect").value;
    const title = $("taskTitleInput").value.trim();
    const description = $("taskDescriptionInput").value.trim();
    const reward = Number($("taskRewardInput").value);

    if (!assignedTo) throw new Error("Выберите пользователя.");
    if (!title) throw new Error("Введите название задачи.");
    if (!description) throw new Error("Введите описание задачи.");
    if (!Number.isFinite(reward) || reward < 0) throw new Error("Введите корректную награду.");

    const userSnapshot = await get(ref(db, `users/${assignedTo}`));

    if (!userSnapshot.exists()) throw new Error("Пользователь не найден.");

    const targetUser = userSnapshot.val();
    const taskRef = push(ref(db, "tasks"));

    await set(taskRef, {
      id: taskRef.key,
      title,
      description,
      reward,
      status: "active",
      assignedTo: targetUser.uid,
      assignedToName: targetUser.username,
      assignedToLoginKey: targetUser.loginKey,
      createdBy: currentUser.uid,
      createdByName: currentProfile.username,
      createdAt: now(),
      updatedAt: now()
    });

    $("taskTitleInput").value = "";
    $("taskDescriptionInput").value = "";
    $("taskRewardInput").value = "";

    setMessage("taskCreateMessage", "Задача создана.", "success");

    await loadAdmin();
  } catch (error) {
    setMessage("taskCreateMessage", friendlyError(error), "error");
  }
}

async function loadReviewTasks() {
  const list = $("reviewTasksList");
  list.innerHTML = `<div class="empty">Загрузка заявок...</div>`;

  const snapshot = await get(ref(db, "tasks"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="empty">Заявок нет.</div>`;
    return;
  }

  const tasks = Object.values(snapshot.val())
    .filter((task) => task.status === "review")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty">Заявок на проверку нет.</div>`;
    return;
  }

  list.innerHTML = tasks.map((task) => {
    return `
      <article class="item-card">
        <div class="item-top">
          <div>
            <span class="pill pending">${escapeHtml(task.assignedToName)}</span>
            <h3>${escapeHtml(task.title)}</h3>
          </div>
          <span class="pill reward">+${Number(task.reward || 0)} ${CURRENCY_CODE}</span>
        </div>

        <p>${escapeHtml(task.description || "Без описания")}</p>
        <p>Отправлено: ${escapeHtml(formatDate(task.submittedAt))}</p>

        <div class="actions">
          <button data-action="approve-task" data-id="${escapeHtml(task.id)}">Одобрить</button>
          <button class="danger" data-action="reject-task" data-id="${escapeHtml(task.id)}">Отклонить</button>
        </div>
      </article>
    `;
  }).join("");
}

async function approveTask(taskId) {
  const taskRef = ref(db, `tasks/${taskId}`);
  const taskSnapshot = await get(taskRef);

  if (!taskSnapshot.exists()) return;

  const task = taskSnapshot.val();

  if (task.status !== "review") return;

  const userRef = ref(db, `users/${task.assignedTo}`);
  const userSnapshot = await get(userRef);

  if (!userSnapshot.exists()) return;

  const user = userSnapshot.val();
  const reward = Number(task.reward || 0);
  const newBalance = Number(user.balance || 0) + reward;

  await update(userRef, {
    balance: newBalance,
    updatedAt: now()
  });

  await update(taskRef, {
    status: "approved",
    reviewedBy: currentUser.uid,
    reviewedByName: currentProfile.username,
    reviewedAt: now(),
    updatedAt: now()
  });

  await createTransaction(
    user,
    "credit",
    reward,
    reward,
    `Задача: ${task.title}`,
    newBalance
  );

  await loadAdmin();
  await loadLeaderboard();
}

async function rejectTask(taskId) {
  await update(ref(db, `tasks/${taskId}`), {
    status: "rejected",
    reviewedBy: currentUser.uid,
    reviewedByName: currentProfile.username,
    reviewedAt: now(),
    updatedAt: now()
  });

  await loadAdmin();
}

async function loadAdminTasksByUsers() {
  const list = $("adminTasksByUsers");
  list.innerHTML = `<div class="empty">Загрузка задач...</div>`;

  const snapshot = await get(ref(db, "tasks"));

  if (!snapshot.exists()) {
    list.innerHTML = `<div class="empty">Задач пока нет.</div>`;
    return;
  }

  const tasks = Object.values(snapshot.val()).sort((a, b) => b.createdAt - a.createdAt);
  const groups = {};

  tasks.forEach((task) => {
    const key = task.assignedToLoginKey || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  list.innerHTML = Object.entries(groups).map(([loginKey, items]) => {
    return `
      <details class="folder-card" open>
        <summary>${escapeHtml(loginKey)} - ${items.length} задач</summary>
        <div class="folder-content">
          ${items.map(renderAdminTaskCard).join("")}
        </div>
      </details>
    `;
  }).join("");
}

function renderAdminTaskCard(task) {
  return `
    <article class="item-card">
      <div class="item-top">
        <div>
          <span class="pill ${escapeHtml(task.status)}">${escapeHtml(getTaskStatusText(task.status))}</span>
          <h3>${escapeHtml(task.title)}</h3>
        </div>
        <span class="pill reward">+${Number(task.reward || 0)} ${CURRENCY_CODE}</span>
      </div>

      <p>${escapeHtml(task.description || "Без описания")}</p>
      <p>Пользователь: ${escapeHtml(task.assignedToName || "unknown")}</p>
      <p>Создано: ${escapeHtml(formatDate(task.createdAt))}</p>
    </article>
  `;
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
    button.addEventListener("click", () => openView(button.dataset.view));
  });

  $("reloadTasksBtn").addEventListener("click", loadTasks);
  $("reloadHistoryBtn").addEventListener("click", loadHistory);
  $("reloadLeaderboardBtn").addEventListener("click", loadLeaderboard);
  $("reloadAdminBtn").addEventListener("click", loadAdmin);

  $("applyOperationBtn").addEventListener("click", applyAdminOperation);
  $("createTaskBtn").addEventListener("click", createTask);

  $("tasksList").addEventListener("click", (event) => {
    const button = event.target.closest(".submit-task-btn");
    if (!button) return;

    submitTask(button.dataset.id);
  });

  $("reviewTasksList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "approve-task") approveTask(id);
    if (action === "reject-task") rejectTask(id);
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
