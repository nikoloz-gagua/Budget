(() => {
  "use strict";

  const STORAGE_KEY = "vault_state";
  const SCHEMA_VERSION = 2;
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const INCOME_CATEGORY_SUGGESTIONS = ["Salary", "Freelance", "Bonus", "Interest", "Gift", "Refund", "Other"];
  const PAGE_META = {
    dashboard: { title: "Dashboard", subtitle: "Overview and forecast" },
    planner: { title: "Planner", subtitle: "Monthly allocations and budget templates" },
    transactions: { title: "Transactions", subtitle: "Income and expenses for the active month" },
    goals: { title: "Goals", subtitle: "Savings targets and contribution planning" },
    settings: { title: "Settings", subtitle: "Profile, backups, and local storage data" }
  };

  const TYPE_ORDER = { fixed: 0, variable: 1, sinking: 2 };
  const PRIORITY_ORDER = { must: 0, should: 1, nice: 2 };

  let state = createDefaultState();
  let toastTimer = null;

  const dom = {};

  function createDefaultTemplates() {
    const presets = [
      { name: "Housing", type: "fixed", priority: "must", defaultAmount: 0, rollover: false },
      { name: "Utilities", type: "fixed", priority: "must", defaultAmount: 0, rollover: false },
      { name: "Groceries", type: "variable", priority: "must", defaultAmount: 0, rollover: false },
      { name: "Transport", type: "variable", priority: "should", defaultAmount: 0, rollover: false },
      { name: "Health", type: "sinking", priority: "must", defaultAmount: 0, rollover: true },
      { name: "Subscriptions", type: "fixed", priority: "should", defaultAmount: 0, rollover: false },
      { name: "Entertainment", type: "variable", priority: "nice", defaultAmount: 0, rollover: false }
    ];
    return presets.map((p) => ({
      id: uid("tpl"),
      categoryId: slugify(p.name),
      name: p.name,
      type: p.type,
      priority: p.priority,
      defaultAmount: round2(p.defaultAmount),
      rollover: !!p.rollover,
      active: true
    }));
  }

  function createDefaultState() {
    const now = new Date();
    return {
      schemaVersion: SCHEMA_VERSION,
      transactions: [],
      budgetTemplates: createDefaultTemplates(),
      monthPlans: {},
      goals: [],
      settings: {
        name: "",
        currencySymbol: "$",
        locale: "en-US"
      },
      ui: {
        activePage: "dashboard",
        txFilter: "all",
        txSearch: ""
      },
      currentMonth: now.getMonth(),
      currentYear: now.getFullYear()
    };
  }

  function uid(prefix) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function slugify(value) {
    const base = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "item";
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateInput(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayLocalInputValue() {
    return formatDateInput(new Date());
  }

  function parseDateParts(dateStr) {
    if (typeof dateStr !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return { year, month, day, date };
  }

  function monthKey(year = state.currentYear, month = state.currentMonth) {
    return `${year}-${pad2(month + 1)}`;
  }

  function parseMonthKey(key) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const monthNum = Number(match[2]);
    if (!year || monthNum < 1 || monthNum > 12) return null;
    return { year, month: monthNum - 1 };
  }

  function formatMonthLabel(year = state.currentYear, month = state.currentMonth) {
    return `${MONTH_NAMES[month]} ${year}`;
  }

  function formatMonthShortLabel(year, month) {
    return `${MONTH_SHORT[month]} ${String(year).slice(-2)}`;
  }

  function addMonths(year, month, delta) {
    const date = new Date(year, month, 1);
    date.setMonth(date.getMonth() + delta);
    return { year: date.getFullYear(), month: date.getMonth() };
  }

  function compareDateStringsDesc(a, b) {
    const pa = parseDateParts(a);
    const pb = parseDateParts(b);
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    const ka = `${pa.year}${pad2(pa.month)}${pad2(pa.day)}`;
    const kb = `${pb.year}${pad2(pb.month)}${pad2(pb.day)}`;
    if (ka === kb) return 0;
    return ka > kb ? -1 : 1;
  }

  function formatDateShort(dateStr) {
    const parts = parseDateParts(dateStr);
    if (!parts) return "Invalid date";
    return new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(parts.date);
  }

  function getLocale() {
    return state.settings.locale || "en-US";
  }

  function getCurrencySymbol() {
    return state.settings.currencySymbol || "$";
  }

  function formatMoney(value) {
    const n = round2(value);
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    const formatted = abs.toLocaleString(getLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${sign}${getCurrencySymbol()}${formatted}`;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "0%";
    return `${Math.round(value * 100)}%`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function isPastMonth(year, month) {
    const now = new Date();
    const currentKey = monthKey(now.getFullYear(), now.getMonth());
    const testKey = monthKey(year, month);
    return testKey < currentKey;
  }

  function isFutureMonth(year, month) {
    const now = new Date();
    const currentKey = monthKey(now.getFullYear(), now.getMonth());
    const testKey = monthKey(year, month);
    return testKey > currentKey;
  }

  function getMonthProgress(monthKeyValue) {
    const parsed = parseMonthKey(monthKeyValue);
    if (!parsed) {
      return { daysInMonth: 30, elapsedDays: 1, daysLeft: 30, isCurrent: false, isPast: false, isFuture: false };
    }
    const totalDays = daysInMonth(parsed.year, parsed.month);
    const now = new Date();
    const isCurrent = now.getFullYear() === parsed.year && now.getMonth() === parsed.month;
    const isPast = isPastMonth(parsed.year, parsed.month);
    const isFuture = isFutureMonth(parsed.year, parsed.month);
    const elapsedDays = isCurrent ? now.getDate() : (isPast ? totalDays : 0);
    const safeElapsed = Math.max(1, elapsedDays || 1);
    const daysLeft = isFuture ? totalDays : Math.max(totalDays - elapsedDays, 0);
    return {
      daysInMonth: totalDays,
      elapsedDays: safeElapsed,
      daysLeft: Math.max(daysLeft, 1),
      isCurrent,
      isPast,
      isFuture
    };
  }

  function sum(items, selector) {
    let total = 0;
    for (const item of items) total += selector(item);
    return total;
  }

  function saveState() {
    state.schemaVersion = SCHEMA_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (dom.schemaInfoText) {
      dom.schemaInfoText.textContent = `Schema version: ${SCHEMA_VERSION}`;
    }
  }

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.hidden = true;
    }, 2600);
  }

  function createEmptyMonthPlan(key) {
    return {
      monthKey: key,
      incomeItems: [
        { id: uid("inc"), name: "Primary income", amount: 0 }
      ],
      categoryAllocations: [],
      goalAllocations: [],
      buffer: 0,
      savingsTarget: 0,
      notes: "",
      closed: false,
      closedAt: null,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeTemplate(raw) {
    const name = String(raw?.name || "").trim() || "New category";
    const categoryId = slugify(raw?.categoryId || name);
    const type = ["fixed", "variable", "sinking"].includes(raw?.type) ? raw.type : "variable";
    const priority = ["must", "should", "nice"].includes(raw?.priority) ? raw.priority : "should";
    return {
      id: String(raw?.id || uid("tpl")),
      categoryId,
      name,
      type,
      priority,
      defaultAmount: Math.max(0, round2(raw?.defaultAmount)),
      rollover: !!raw?.rollover,
      active: raw?.active !== false
    };
  }

  function normalizeTransaction(raw) {
    const type = raw?.type === "income" ? "income" : "expense";
    const amount = Math.max(0, round2(raw?.amount));
    const dateStr = parseDateParts(raw?.date) ? raw.date : todayLocalInputValue();
    const categoryName = String(raw?.categoryName || raw?.category || "Other").trim() || "Other";
    const categoryId = slugify(raw?.categoryId || categoryName);
    return {
      id: String(raw?.id || uid("tx")),
      type,
      amount,
      date: dateStr,
      categoryId,
      categoryName,
      description: String(raw?.description ?? raw?.desc ?? "").trim(),
      note: String(raw?.note || "").trim()
    };
  }

  function normalizeGoal(raw) {
    const deadline = parseDateParts(raw?.deadline) ? raw.deadline : "";
    return {
      id: String(raw?.id || uid("goal")),
      name: String(raw?.name || "Goal").trim() || "Goal",
      target: Math.max(0.01, round2(raw?.target || 0)),
      saved: Math.max(0, round2(raw?.saved || 0)),
      deadline
    };
  }

  function normalizeGoalAllocation(raw) {
    return {
      id: String(raw?.id || uid("galloc")),
      goalId: String(raw?.goalId || ""),
      planned: Math.max(0, round2(raw?.planned || 0))
    };
  }

  function normalizeCategoryAllocation(raw) {
    const name = String(raw?.name || "Category").trim() || "Category";
    const categoryId = slugify(raw?.categoryId || name);
    const type = ["fixed", "variable", "sinking"].includes(raw?.type) ? raw.type : "variable";
    const priority = ["must", "should", "nice"].includes(raw?.priority) ? raw.priority : "should";
    return {
      id: String(raw?.id || uid("alloc")),
      templateId: raw?.templateId ? String(raw.templateId) : null,
      categoryId,
      name,
      type,
      priority,
      planned: Math.max(0, round2(raw?.planned || 0)),
      carryIn: Math.max(0, round2(raw?.carryIn || 0)),
      rollover: !!raw?.rollover
    };
  }

  function normalizeIncomeItem(raw) {
    return {
      id: String(raw?.id || uid("inc")),
      name: String(raw?.name || "Income").trim() || "Income",
      amount: Math.max(0, round2(raw?.amount || 0))
    };
  }

  function normalizeMonthPlan(raw, key) {
    const plan = createEmptyMonthPlan(key);
    plan.incomeItems = Array.isArray(raw?.incomeItems) && raw.incomeItems.length
      ? raw.incomeItems.map(normalizeIncomeItem)
      : plan.incomeItems;
    plan.categoryAllocations = Array.isArray(raw?.categoryAllocations)
      ? raw.categoryAllocations.map(normalizeCategoryAllocation)
      : [];
    plan.goalAllocations = Array.isArray(raw?.goalAllocations)
      ? raw.goalAllocations.map(normalizeGoalAllocation)
      : [];
    plan.buffer = Math.max(0, round2(raw?.buffer || 0));
    plan.savingsTarget = Math.max(0, round2(raw?.savingsTarget || 0));
    plan.notes = String(raw?.notes || "");
    plan.closed = !!raw?.closed;
    plan.closedAt = raw?.closedAt ? String(raw.closedAt) : null;
    plan.updatedAt = String(raw?.updatedAt || new Date().toISOString());
    return plan;
  }

  function dedupeTemplates(templates) {
    const map = new Map();
    for (const raw of templates) {
      const tpl = normalizeTemplate(raw);
      if (map.has(tpl.categoryId)) {
        const existing = map.get(tpl.categoryId);
        existing.defaultAmount = Math.max(existing.defaultAmount, tpl.defaultAmount);
        existing.rollover = existing.rollover || tpl.rollover;
        if (tpl.name.length > existing.name.length) existing.name = tpl.name;
      } else {
        map.set(tpl.categoryId, tpl);
      }
    }
    return Array.from(map.values()).sort(sortTemplates);
  }

  function sortTemplates(a, b) {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  }

  function sortAllocations(a, b) {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  }

  function migrateLegacyState(raw) {
    const next = createDefaultState();

    if (raw && typeof raw === "object") {
      if (Number.isInteger(raw.currentMonth) && raw.currentMonth >= 0 && raw.currentMonth <= 11) {
        next.currentMonth = raw.currentMonth;
      }
      if (Number.isInteger(raw.currentYear) && raw.currentYear >= 2000 && raw.currentYear <= 3000) {
        next.currentYear = raw.currentYear;
      }

      if (raw.settings && typeof raw.settings === "object") {
        next.settings.name = String(raw.settings.name || "");
        next.settings.currencySymbol = String(raw.settings.currency || raw.settings.currencySymbol || "$");
        next.settings.locale = String(raw.settings.locale || "en-US");
      }

      const legacyBudgetList = Array.isArray(raw.budgets) ? raw.budgets : [];
      const templateMap = new Map(next.budgetTemplates.map((t) => [t.categoryId, t]));
      for (const legacyBudget of legacyBudgetList) {
        const name = String(legacyBudget?.cat || legacyBudget?.name || "").trim();
        if (!name) continue;
        const categoryId = slugify(name);
        const limit = Math.max(0, round2(legacyBudget?.limit || 0));
        const guessedType = /rent|mortgage|utility|bill|subscription|insurance/i.test(name) ? "fixed" : "variable";
        const guessedPriority = guessedType === "fixed" ? "must" : "should";
        if (templateMap.has(categoryId)) {
          const tpl = templateMap.get(categoryId);
          tpl.name = name;
          tpl.defaultAmount = Math.max(tpl.defaultAmount, limit);
          tpl.type = tpl.defaultAmount > 0 ? tpl.type : guessedType;
          tpl.priority = guessedPriority;
        } else {
          const tpl = normalizeTemplate({
            name,
            categoryId,
            defaultAmount: limit,
            type: guessedType,
            priority: guessedPriority,
            rollover: false
          });
          templateMap.set(categoryId, tpl);
        }
      }
      next.budgetTemplates = Array.from(templateMap.values()).sort(sortTemplates);

      const legacyTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];
      next.transactions = legacyTransactions.map(normalizeTransaction);

      const legacyGoals = Array.isArray(raw.goals) ? raw.goals : [];
      next.goals = legacyGoals
        .map((g) => {
          if (!g) return null;
          const normalized = normalizeGoal({
            id: g.id,
            name: g.name,
            target: g.target,
            saved: g.saved,
            deadline: g.deadline
          });
          return normalized.target > 0 ? normalized : null;
        })
        .filter(Boolean);

      const monthlyPlansRaw = raw.settings && raw.settings.monthlyPlans && typeof raw.settings.monthlyPlans === "object"
        ? raw.settings.monthlyPlans
        : {};

      for (const [key, legacyPlan] of Object.entries(monthlyPlansRaw)) {
        if (!parseMonthKey(key)) continue;
        const plan = createEmptyMonthPlan(key);
        const income = Math.max(0, round2(legacyPlan?.income || 0));
        const fixed = Math.max(0, round2(legacyPlan?.fixed || 0));
        const savings = Math.max(0, round2(legacyPlan?.savings || 0));
        const buffer = Math.max(0, round2(legacyPlan?.buffer || 0));
        plan.incomeItems = [{ id: uid("inc"), name: "Planned income", amount: income }];
        plan.buffer = buffer;
        plan.savingsTarget = savings;
        if (fixed > 0) {
          const fixedCategoryId = "fixed-costs";
          if (!next.budgetTemplates.some((t) => t.categoryId === fixedCategoryId)) {
            next.budgetTemplates.push(normalizeTemplate({
              name: "Fixed Costs",
              categoryId: fixedCategoryId,
              type: "fixed",
              priority: "must",
              defaultAmount: fixed,
              rollover: false
            }));
          }
          plan.categoryAllocations.push(normalizeCategoryAllocation({
            categoryId: fixedCategoryId,
            name: "Fixed Costs",
            type: "fixed",
            priority: "must",
            planned: fixed,
            carryIn: 0,
            rollover: false
          }));
        }
        next.monthPlans[key] = plan;
      }
    }

    next.schemaVersion = SCHEMA_VERSION;
    next.budgetTemplates = dedupeTemplates(next.budgetTemplates);
    return normalizeState(next);
  }

  function normalizeState(raw) {
    const defaults = createDefaultState();
    const next = {
      ...defaults,
      schemaVersion: SCHEMA_VERSION
    };

    if (raw && typeof raw === "object") {
      next.transactions = Array.isArray(raw.transactions) ? raw.transactions.map(normalizeTransaction) : [];
      next.budgetTemplates = Array.isArray(raw.budgetTemplates) && raw.budgetTemplates.length
        ? dedupeTemplates(raw.budgetTemplates)
        : defaults.budgetTemplates;
      next.goals = Array.isArray(raw.goals)
        ? raw.goals.map(normalizeGoal).filter((g) => g.target > 0)
        : [];

      next.settings = {
        name: String(raw.settings?.name || ""),
        currencySymbol: String(raw.settings?.currencySymbol || raw.settings?.currency || "$").slice(0, 4) || "$",
        locale: String(raw.settings?.locale || "en-US") || "en-US"
      };

      next.ui = {
        activePage: PAGE_META[raw.ui?.activePage] ? raw.ui.activePage : "dashboard",
        txFilter: ["all", "income", "expense"].includes(raw.ui?.txFilter) ? raw.ui.txFilter : "all",
        txSearch: String(raw.ui?.txSearch || "")
      };

      next.currentMonth = Number.isInteger(raw.currentMonth) && raw.currentMonth >= 0 && raw.currentMonth <= 11
        ? raw.currentMonth
        : defaults.currentMonth;
      next.currentYear = Number.isInteger(raw.currentYear) && raw.currentYear > 2000 && raw.currentYear < 4000
        ? raw.currentYear
        : defaults.currentYear;

      next.monthPlans = {};
      if (raw.monthPlans && typeof raw.monthPlans === "object") {
        for (const [key, planRaw] of Object.entries(raw.monthPlans)) {
          if (!parseMonthKey(key)) continue;
          next.monthPlans[key] = normalizeMonthPlan(planRaw, key);
        }
      }
    }

    if (!next.budgetTemplates.length) {
      next.budgetTemplates = createDefaultTemplates();
    }

    return next;
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state = createDefaultState();
      ensureMonthPlan(monthKey(), true);
      saveState();
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION) {
        state = normalizeState(parsed);
      } else {
        state = migrateLegacyState(parsed);
        showToast("Existing data migrated to the new planner model.");
      }
      ensureMonthPlan(monthKey(), true);
      saveState();
    } catch (error) {
      console.error("Failed to load state", error);
      state = createDefaultState();
      ensureMonthPlan(monthKey(), true);
      saveState();
      showToast("Stored data could not be read. A fresh budget file was created.");
    }
  }

  function createAllocationFromTemplate(template) {
    return normalizeCategoryAllocation({
      templateId: template.id,
      categoryId: template.categoryId,
      name: template.name,
      type: template.type,
      priority: template.priority,
      planned: template.defaultAmount,
      carryIn: 0,
      rollover: template.rollover
    });
  }

  function createGoalAllocation(goal) {
    return normalizeGoalAllocation({
      goalId: goal.id,
      planned: 0
    });
  }

  function syncPlanReferences(plan, options = {}) {
    const { overwriteTemplateDefaults = false, includeAllGoals = true } = options;
    let changed = false;

    const rowByCategory = new Map();
    for (const row of plan.categoryAllocations) {
      rowByCategory.set(row.categoryId, row);
    }

    for (const template of state.budgetTemplates.filter((t) => t.active !== false)) {
      const existing = rowByCategory.get(template.categoryId);
      if (!existing) {
        plan.categoryAllocations.push(createAllocationFromTemplate(template));
        changed = true;
        continue;
      }

      const before = JSON.stringify(existing);
      existing.templateId = template.id;
      existing.categoryId = template.categoryId;
      existing.name = template.name;
      existing.type = template.type;
      existing.priority = template.priority;
      existing.rollover = template.rollover;
      if (overwriteTemplateDefaults) {
        existing.planned = template.defaultAmount;
      }
      if (JSON.stringify(existing) !== before) changed = true;
    }

    if (includeAllGoals) {
      const goalAllocById = new Map(plan.goalAllocations.map((g) => [g.goalId, g]));
      for (const goal of state.goals) {
        if (!goalAllocById.has(goal.id)) {
          plan.goalAllocations.push(createGoalAllocation(goal));
          changed = true;
        }
      }
      const validGoalIds = new Set(state.goals.map((g) => g.id));
      const beforeCount = plan.goalAllocations.length;
      plan.goalAllocations = plan.goalAllocations.filter((g) => validGoalIds.has(g.goalId));
      if (plan.goalAllocations.length !== beforeCount) changed = true;
    }

    plan.categoryAllocations = plan.categoryAllocations.map(normalizeCategoryAllocation).sort(sortAllocations);
    plan.goalAllocations = plan.goalAllocations.map(normalizeGoalAllocation);
    plan.updatedAt = new Date().toISOString();

    return changed;
  }

  function ensureMonthPlan(key = monthKey(), saveIfCreated = false) {
    let changed = false;
    if (!state.monthPlans[key]) {
      state.monthPlans[key] = createEmptyMonthPlan(key);
      changed = true;
    }
    changed = syncPlanReferences(state.monthPlans[key]) || changed;
    if (changed && saveIfCreated) saveState();
    return state.monthPlans[key];
  }

  function getMonthTransactions(key = monthKey()) {
    const parsed = parseMonthKey(key);
    if (!parsed) return [];
    return state.transactions.filter((tx) => {
      const parts = parseDateParts(tx.date);
      return parts && parts.year === parsed.year && parts.month - 1 === parsed.month;
    });
  }

  function getTemplateById(templateId) {
    return state.budgetTemplates.find((t) => t.id === templateId) || null;
  }

  function getGoalById(goalId) {
    return state.goals.find((g) => g.id === goalId) || null;
  }

  function computeCategoryForecast(actual, progress) {
    if (progress.isFuture) return 0;
    if (progress.isPast) return round2(actual);
    if (actual <= 0) return 0;
    return round2((actual / progress.elapsedDays) * progress.daysInMonth);
  }

  function computeMonthMetrics(key = monthKey()) {
    const plan = ensureMonthPlan(key);
    const tx = getMonthTransactions(key);
    const progress = getMonthProgress(key);

    const expenses = tx.filter((t) => t.type === "expense");
    const incomes = tx.filter((t) => t.type === "income");

    const actualByCategory = new Map();
    for (const t of expenses) {
      actualByCategory.set(t.categoryId, round2((actualByCategory.get(t.categoryId) || 0) + t.amount));
    }

    const rows = plan.categoryAllocations.map((row) => {
      const actual = round2(actualByCategory.get(row.categoryId) || 0);
      const available = round2(row.planned + row.carryIn);
      const remaining = round2(available - actual);
      const forecast = computeCategoryForecast(actual, progress);
      const variance = round2(available - forecast);
      const pctUsed = available > 0 ? actual / available : (actual > 0 ? 1 : 0);
      return {
        ...row,
        actual,
        available,
        remaining,
        forecast,
        variance,
        pctUsed
      };
    });

    const plannedIncome = round2(sum(plan.incomeItems, (x) => x.amount));
    const plannedCategoryBase = round2(sum(plan.categoryAllocations, (x) => x.planned));
    const plannedCategoryAvailable = round2(sum(rows, (x) => x.available));
    const plannedGoals = round2(sum(plan.goalAllocations, (x) => x.planned));
    const plannedBuffer = round2(plan.buffer);
    const plannedSavingsTarget = round2(plan.savingsTarget);
    const plannedOutflows = round2(plannedCategoryBase + plannedGoals + plannedBuffer + plannedSavingsTarget);
    const unallocated = round2(plannedIncome - plannedOutflows);

    const actualIncome = round2(sum(incomes, (x) => x.amount));
    const actualExpense = round2(sum(expenses, (x) => x.amount));
    const actualNet = round2(actualIncome - actualExpense);

    const remainingFlexible = round2(sum(rows.filter((r) => r.type !== "fixed"), (r) => Math.max(0, r.remaining)));
    const remainingFixed = round2(sum(rows.filter((r) => r.type === "fixed"), (r) => Math.max(0, r.remaining)));
    const availableToSpend = round2(remainingFlexible + unallocated);
    const dailyAllowance = round2(availableToSpend / progress.daysLeft);

    const projectedExpense = progress.isFuture ? 0 : round2((actualExpense / progress.elapsedDays) * progress.daysInMonth);
    const projectedIncome = progress.isFuture
      ? plannedIncome
      : round2((actualIncome / progress.elapsedDays) * progress.daysInMonth);
    const projectedNet = round2(projectedIncome - projectedExpense);

    const fixedRows = rows.filter((r) => r.type === "fixed");
    const variableRows = rows.filter((r) => r.type === "variable");
    const sinkingRows = rows.filter((r) => r.type === "sinking");

    const budgetUsagePct = plannedCategoryAvailable > 0 ? clamp(actualExpense / plannedCategoryAvailable, 0, 2) : 0;
    const savingsRateActual = actualIncome > 0 ? (actualNet / actualIncome) : 0;
    const savingsRateProjected = projectedIncome > 0 ? (projectedNet / projectedIncome) : 0;

    const unplannedExpenseCategories = [];
    for (const [categoryId, amount] of actualByCategory.entries()) {
      if (!rows.some((r) => r.categoryId === categoryId)) {
        const example = expenses.find((t) => t.categoryId === categoryId);
        unplannedExpenseCategories.push({
          categoryId,
          categoryName: example?.categoryName || categoryId,
          amount
        });
      }
    }

    return {
      key,
      plan,
      tx,
      incomes,
      expenses,
      progress,
      rows,
      fixedRows,
      variableRows,
      sinkingRows,
      actualByCategory,
      plannedIncome,
      plannedCategoryBase,
      plannedCategoryAvailable,
      plannedGoals,
      plannedBuffer,
      plannedSavingsTarget,
      plannedOutflows,
      unallocated,
      actualIncome,
      actualExpense,
      actualNet,
      remainingFlexible,
      remainingFixed,
      availableToSpend,
      dailyAllowance,
      projectedExpense,
      projectedIncome,
      projectedNet,
      budgetUsagePct,
      savingsRateActual,
      savingsRateProjected,
      unplannedExpenseCategories
    };
  }

  function buildInsights(metrics) {
    const items = [];
    const curMonthParsed = parseMonthKey(metrics.key);
    const monthName = curMonthParsed ? `${MONTH_NAMES[curMonthParsed.month]} ${curMonthParsed.year}` : "this month";

    if (metrics.plannedIncome <= 0) {
      items.push({
        level: "warn",
        title: "No planned income set",
        text: "Add one or more income plan rows in Planner so the app can calculate allocations and safe-to-spend guidance."
      });
    }

    if (metrics.unallocated < 0) {
      items.push({
        level: "bad",
        title: "Planned allocations exceed planned income",
        text: `Your plan is over-allocated by ${formatMoney(Math.abs(metrics.unallocated))}. Reduce category targets, goals, savings target, or buffer.`
      });
    } else if (metrics.unallocated > 0) {
      items.push({
        level: "warn",
        title: "Income not fully allocated",
        text: `${formatMoney(metrics.unallocated)} is still unallocated in ${monthName}. You can keep it unassigned or move it into buffer, savings, or categories.`
      });
    }

    if (metrics.availableToSpend < 0) {
      items.push({
        level: "bad",
        title: "Flexible spending is over plan",
        text: `Available-to-spend is ${formatMoney(metrics.availableToSpend)}. Review variable and sinking categories or reallocate budget.`
      });
    }

    const overspentRows = metrics.rows
      .filter((r) => r.remaining < 0)
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, 3);
    for (const row of overspentRows) {
      items.push({
        level: "bad",
        title: `${row.name} is over budget`,
        text: `Overspent by ${formatMoney(Math.abs(row.remaining))}. Forecast: ${formatMoney(row.forecast)} vs available ${formatMoney(row.available)}.`
      });
    }

    const forecastRiskRows = metrics.rows
      .filter((r) => r.remaining >= 0 && r.forecast > r.available && r.available > 0)
      .sort((a, b) => (b.forecast - b.available) - (a.forecast - a.available))
      .slice(0, 2);
    for (const row of forecastRiskRows) {
      items.push({
        level: "warn",
        title: `${row.name} pacing above plan`,
        text: `At current pace, forecast is ${formatMoney(row.forecast)} against ${formatMoney(row.available)} available.`
      });
    }

    if (metrics.unplannedExpenseCategories.length) {
      const topUnplanned = metrics.unplannedExpenseCategories
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 2)
        .map((u) => `${u.categoryName} (${formatMoney(u.amount)})`)
        .join(", ");
      items.push({
        level: "warn",
        title: "Spending in unplanned categories",
        text: `Transactions were logged in categories not present in this month's plan: ${topUnplanned}. Add rows in Planner or create templates.`
      });
    }

    if (!metrics.tx.length) {
      items.push({
        level: "",
        title: "No transactions for the active month yet",
        text: "This is a good time to set allocations before spending starts."
      });
    }

    if (!metrics.plan.closed && isPastMonth(curMonthParsed?.year || state.currentYear, curMonthParsed?.month || state.currentMonth)) {
      items.push({
        level: "warn",
        title: "Past month not closed",
        text: "Close the month from Planner to carry rollover balances into the next month."
      });
    }

    if (!items.length) {
      items.push({
        level: "",
        title: "Plan looks balanced",
        text: "Keep logging transactions to improve forecasting accuracy."
      });
    }

    return items.slice(0, 6);
  }

  function getTrendMetrics(count = 6) {
    const result = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const target = addMonths(state.currentYear, state.currentMonth, -i);
      const key = monthKey(target.year, target.month);
      const tx = getMonthTransactions(key);
      const income = round2(sum(tx.filter((t) => t.type === "income"), (x) => x.amount));
      const expense = round2(sum(tx.filter((t) => t.type === "expense"), (x) => x.amount));
      const net = round2(Math.max(0, income - expense));
      result.push({
        key,
        year: target.year,
        month: target.month,
        income,
        expense,
        net
      });
    }
    return result;
  }

  function cacheDom() {
    dom.pageTitle = document.getElementById("pageTitle");
    dom.pageSubtitle = document.getElementById("pageSubtitle");
    dom.globalMonthLabel = document.getElementById("globalMonthLabel");
    dom.mobileMenuButton = document.getElementById("mobileMenuButton");
    dom.toast = document.getElementById("toast");
    dom.schemaInfoText = document.getElementById("schemaInfoText");

    dom.dashHeroTitle = document.getElementById("dashHeroTitle");
    dom.dashHeroText = document.getElementById("dashHeroText");
    dom.heroPillStatus = document.getElementById("heroPillStatus");
    dom.heroPillAllowance = document.getElementById("heroPillAllowance");
    dom.heroAvailableValue = document.getElementById("heroAvailableValue");
    dom.heroAvailableMeta = document.getElementById("heroAvailableMeta");
    dom.heroProgressFill = document.getElementById("heroProgressFill");
    dom.heroProgressCaption = document.getElementById("heroProgressCaption");

    dom.kpiPlannedIncome = document.getElementById("kpiPlannedIncome");
    dom.kpiPlannedIncomeSub = document.getElementById("kpiPlannedIncomeSub");
    dom.kpiActualIncome = document.getElementById("kpiActualIncome");
    dom.kpiActualIncomeSub = document.getElementById("kpiActualIncomeSub");
    dom.kpiActualExpense = document.getElementById("kpiActualExpense");
    dom.kpiActualExpenseSub = document.getElementById("kpiActualExpenseSub");
    dom.kpiUnallocated = document.getElementById("kpiUnallocated");
    dom.kpiUnallocatedSub = document.getElementById("kpiUnallocatedSub");
    dom.kpiProjectedExpense = document.getElementById("kpiProjectedExpense");
    dom.kpiProjectedExpenseSub = document.getElementById("kpiProjectedExpenseSub");
    dom.kpiActualNet = document.getElementById("kpiActualNet");
    dom.kpiActualNetSub = document.getElementById("kpiActualNetSub");

    dom.trendChart = document.getElementById("trendChart");
    dom.dashCategoryList = document.getElementById("dashCategoryList");
    dom.dashInsights = document.getElementById("dashInsights");
    dom.dashRecentTransactions = document.getElementById("dashRecentTransactions");

    dom.plannerSummaryStrip = document.getElementById("plannerSummaryStrip");
    dom.incomePlanRows = document.getElementById("incomePlanRows");
    dom.incomePlanTotal = document.getElementById("incomePlanTotal");
    dom.planBufferInput = document.getElementById("planBufferInput");
    dom.planSavingsTargetInput = document.getElementById("planSavingsTargetInput");
    dom.planNotesInput = document.getElementById("planNotesInput");
    dom.goalAllocationRows = document.getElementById("goalAllocationRows");
    dom.allocationTableBody = document.getElementById("allocationTableBody");
    dom.templateList = document.getElementById("templateList");

    dom.transactionsList = document.getElementById("transactionsList");
    dom.txSearchInput = document.getElementById("txSearchInput");

    dom.goalsList = document.getElementById("goalsList");

    dom.settingNameInput = document.getElementById("settingNameInput");
    dom.settingCurrencyInput = document.getElementById("settingCurrencyInput");
    dom.settingLocaleInput = document.getElementById("settingLocaleInput");
    dom.importFileInput = document.getElementById("importFileInput");

    dom.txModal = document.getElementById("txModal");
    dom.txForm = document.getElementById("txForm");
    dom.txEditId = document.getElementById("txEditId");
    dom.txTypeInput = document.getElementById("txTypeInput");
    dom.txDateInput = document.getElementById("txDateInput");
    dom.txAmountInput = document.getElementById("txAmountInput");
    dom.txCategoryInput = document.getElementById("txCategoryInput");
    dom.txCategoryOptions = document.getElementById("txCategoryOptions");
    dom.txDescriptionInput = document.getElementById("txDescriptionInput");
    dom.txNoteInput = document.getElementById("txNoteInput");
    dom.txModalTitle = document.getElementById("txModalTitle");

    dom.templateModal = document.getElementById("templateModal");
    dom.templateForm = document.getElementById("templateForm");
    dom.templateEditId = document.getElementById("templateEditId");
    dom.templateNameInput = document.getElementById("templateNameInput");
    dom.templateTypeInput = document.getElementById("templateTypeInput");
    dom.templatePriorityInput = document.getElementById("templatePriorityInput");
    dom.templateAmountInput = document.getElementById("templateAmountInput");
    dom.templateRolloverInput = document.getElementById("templateRolloverInput");
    dom.templateModalTitle = document.getElementById("templateModalTitle");

    dom.goalModal = document.getElementById("goalModal");
    dom.goalForm = document.getElementById("goalForm");
    dom.goalEditId = document.getElementById("goalEditId");
    dom.goalNameInput = document.getElementById("goalNameInput");
    dom.goalTargetInput = document.getElementById("goalTargetInput");
    dom.goalSavedInput = document.getElementById("goalSavedInput");
    dom.goalDeadlineInput = document.getElementById("goalDeadlineInput");
    dom.goalModalTitle = document.getElementById("goalModalTitle");
  }

  function setActivePage(page) {
    if (!PAGE_META[page]) return;
    state.ui.activePage = page;

    document.querySelectorAll(".page").forEach((node) => {
      node.classList.toggle("is-active", node.id === `page-${page}`);
    });
    document.querySelectorAll(".nav-btn[data-page]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === page);
    });

    const meta = PAGE_META[page];
    dom.pageTitle.textContent = meta.title;
    dom.pageSubtitle.textContent = meta.subtitle;
    document.body.classList.remove("nav-open");

    saveState();
  }

  function changeMonthBy(delta) {
    const next = addMonths(state.currentYear, state.currentMonth, delta);
    state.currentYear = next.year;
    state.currentMonth = next.month;
    ensureMonthPlan(monthKey(), true);
    saveState();
    renderAll();
  }

  function renderChrome() {
    dom.globalMonthLabel.textContent = formatMonthLabel();
    const meta = PAGE_META[state.ui.activePage] || PAGE_META.dashboard;
    dom.pageTitle.textContent = meta.title;
    dom.pageSubtitle.textContent = meta.subtitle;
    document.querySelectorAll(".nav-btn[data-page]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === state.ui.activePage);
    });
    document.querySelectorAll(".page").forEach((pageNode) => {
      pageNode.classList.toggle("is-active", pageNode.id === `page-${state.ui.activePage}`);
    });
    if (dom.schemaInfoText) dom.schemaInfoText.textContent = `Schema version: ${SCHEMA_VERSION}`;
  }

  function renderDashboard() {
    const metrics = computeMonthMetrics();
    const monthLabel = formatMonthLabel();
    const greeting = state.settings.name ? `Hi ${state.settings.name},` : "Your";
    dom.dashHeroTitle.textContent = `${greeting} ${monthLabel} budget dashboard`;

    const heroLineParts = [];
    heroLineParts.push(`Planned income ${formatMoney(metrics.plannedIncome)}`);
    heroLineParts.push(`planned allocations ${formatMoney(metrics.plannedOutflows)}`);
    if (metrics.plan.closed) heroLineParts.push("month closed");
    dom.dashHeroText.textContent = heroLineParts.join(", ") + ".";

    const statusText = metrics.unallocated < 0
      ? `Over-allocated by ${formatMoney(Math.abs(metrics.unallocated))}`
      : metrics.unallocated > 0
        ? `${formatMoney(metrics.unallocated)} unallocated`
        : "Fully allocated";
    dom.heroPillStatus.textContent = statusText;
    dom.heroPillAllowance.textContent = `Daily allowance ${formatMoney(metrics.dailyAllowance)}`;

    dom.heroAvailableValue.textContent = formatMoney(metrics.availableToSpend);
    dom.heroAvailableValue.className = `hero-panel-value ${metrics.availableToSpend < 0 ? "amount-bad" : metrics.availableToSpend < 25 ? "amount-warn" : "amount-good"}`;

    const budgetPct = Math.max(0, Math.round(clamp(metrics.budgetUsagePct, 0, 1.2) * 100));
    dom.heroProgressFill.style.width = `${Math.min(budgetPct, 100)}%`;
    dom.heroProgressCaption.textContent = `${formatPercent(metrics.budgetUsagePct)} of planned category budget spent`;
    dom.heroAvailableMeta.textContent = metrics.progress.isFuture
      ? "Future month selected. Forecast uses plan values until transactions arrive."
      : `${metrics.progress.daysLeft} day(s) left in month. Flexible budget remaining ${formatMoney(metrics.remainingFlexible)}.`;

    dom.kpiPlannedIncome.textContent = formatMoney(metrics.plannedIncome);
    dom.kpiPlannedIncomeSub.textContent = `${metrics.plan.incomeItems.length} income source(s)`;
    dom.kpiActualIncome.textContent = formatMoney(metrics.actualIncome);
    dom.kpiActualIncomeSub.textContent = `${metrics.incomes.length} income transaction(s)`;
    dom.kpiActualExpense.textContent = formatMoney(metrics.actualExpense);
    dom.kpiActualExpenseSub.textContent = `${metrics.expenses.length} expense transaction(s)`;
    dom.kpiUnallocated.textContent = formatMoney(metrics.unallocated);
    dom.kpiUnallocated.className = metrics.unallocated < 0 ? "amount-bad" : metrics.unallocated > 0 ? "amount-warn" : "";
    dom.kpiUnallocatedSub.textContent = "Planned income minus planned outflows";
    dom.kpiProjectedExpense.textContent = formatMoney(metrics.projectedExpense);
    dom.kpiProjectedExpenseSub.textContent = metrics.progress.isFuture ? "Future month" : `Pacing forecast (${formatPercent(metrics.savingsRateProjected)} projected savings rate)`;
    dom.kpiActualNet.textContent = formatMoney(metrics.actualNet);
    dom.kpiActualNet.className = metrics.actualNet < 0 ? "amount-bad" : "amount-good";
    dom.kpiActualNetSub.textContent = `Actual savings rate ${formatPercent(metrics.savingsRateActual)}`;

    renderTrendChart();
    renderDashboardCategoryHealth(metrics);
    renderInsightList(dom.dashInsights, buildInsights(metrics));
    renderTransactionList(dom.dashRecentTransactions, metrics.tx.slice().sort((a, b) => compareDateStringsDesc(a.date, b.date)).slice(0, 6), {
      compact: true,
      showActions: false
    });
  }

  function renderTrendChart() {
    const trend = getTrendMetrics(6);
    const maxValue = Math.max(
      1,
      ...trend.map((m) => m.income),
      ...trend.map((m) => m.expense),
      ...trend.map((m) => m.net)
    );

    dom.trendChart.innerHTML = trend.map((m) => {
      const incomeHeight = Math.max(4, Math.round((m.income / maxValue) * 140));
      const expenseHeight = Math.max(4, Math.round((m.expense / maxValue) * 140));
      const netHeight = Math.max(4, Math.round((m.net / maxValue) * 140));
      return `
        <div class="trend-column" title="${esc(formatMonthLabel(m.year, m.month))}">
          <div class="trend-bars">
            <div class="trend-bar income" style="height:${incomeHeight}px" aria-hidden="true"></div>
            <div class="trend-bar expense" style="height:${expenseHeight}px" aria-hidden="true"></div>
            <div class="trend-bar net" style="height:${netHeight}px" aria-hidden="true"></div>
          </div>
          <div class="trend-label">${esc(formatMonthShortLabel(m.year, m.month))}</div>
        </div>
      `;
    }).join("");
  }

  function renderDashboardCategoryHealth(metrics) {
    const rows = [...metrics.rows].sort((a, b) => {
      const scoreA = Math.abs(a.remaining) + a.actual;
      const scoreB = Math.abs(b.remaining) + b.actual;
      return scoreB - scoreA;
    });
    const topRows = rows.slice(0, 6);

    if (!topRows.length) {
      dom.dashCategoryList.innerHTML = `<div class="empty-state">No category allocations yet. Open Planner and create template categories or apply template defaults.</div>`;
      return;
    }

    dom.dashCategoryList.innerHTML = topRows.map((row) => {
      const pct = row.available > 0 ? clamp(row.actual / row.available, 0, 1.4) : 0;
      const pctDisplay = Math.round(pct * 100);
      const statusClass = row.remaining < 0 ? "bad" : row.forecast > row.available ? "warn" : "good";
      const forecastDelta = row.forecast - row.available;
      const footText = row.remaining < 0
        ? `Over by ${formatMoney(Math.abs(row.remaining))}`
        : `Remaining ${formatMoney(row.remaining)}`;
      const forecastText = forecastDelta > 0
        ? `Forecast +${formatMoney(forecastDelta)}`
        : `Forecast ${formatMoney(row.forecast)}`;

      return `
        <div class="category-health-item">
          <div class="category-health-head">
            <div>
              <div class="category-name">${esc(row.name)}</div>
              <div class="category-meta">${esc(row.type)} · ${esc(row.priority)} · available ${esc(formatMoney(row.available))}</div>
            </div>
            <div class="category-meta mono">${pctDisplay}%</div>
          </div>
          <div class="category-track">
            <div class="category-fill" style="width:${Math.min(pctDisplay, 100)}%"></div>
          </div>
          <div class="category-foot">
            <span class="${statusClass}">${esc(footText)}</span>
            <span class="muted">${esc(forecastText)}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderInsightList(target, items) {
    if (!items.length) {
      target.innerHTML = `<div class="empty-state">No insights yet.</div>`;
      return;
    }

    target.innerHTML = items.map((item) => `
      <article class="insight-item" data-level="${esc(item.level || "")}">
        <div class="insight-title">${esc(item.title)}</div>
        <div class="insight-text">${esc(item.text)}</div>
      </article>
    `).join("");
  }

  function renderPlanner() {
    const metrics = computeMonthMetrics();
    const plan = metrics.plan;

    renderPlannerSummary(metrics);
    renderIncomePlanRows(plan);
    dom.planBufferInput.value = String(plan.buffer || "");
    dom.planSavingsTargetInput.value = String(plan.savingsTarget || "");
    dom.planNotesInput.value = plan.notes || "";
    renderGoalAllocations(metrics);
    renderAllocationTable(metrics);
    renderTemplateList();
  }

  function renderPlannerSummary(metrics) {
    const chips = [
      { label: "Planned income", value: formatMoney(metrics.plannedIncome), cls: "good" },
      { label: "Planned outflows", value: formatMoney(metrics.plannedOutflows), cls: metrics.plannedOutflows > metrics.plannedIncome && metrics.plannedIncome > 0 ? "bad" : "" },
      { label: "Unallocated", value: formatMoney(metrics.unallocated), cls: metrics.unallocated < 0 ? "bad" : metrics.unallocated > 0 ? "warn" : "good" },
      { label: "Available to spend", value: formatMoney(metrics.availableToSpend), cls: metrics.availableToSpend < 0 ? "bad" : "good" },
      { label: "Daily allowance", value: formatMoney(metrics.dailyAllowance), cls: metrics.dailyAllowance < 0 ? "bad" : metrics.dailyAllowance < 10 ? "warn" : "good" }
    ];

    dom.plannerSummaryStrip.innerHTML = chips.map((chip) => `
      <div class="summary-chip">
        <div class="summary-chip-label">${esc(chip.label)}</div>
        <div class="summary-chip-value ${esc(chip.cls || "")}">${esc(chip.value)}</div>
      </div>
    `).join("");
  }

  function renderIncomePlanRows(plan) {
    if (!plan.incomeItems.length) {
      plan.incomeItems.push(normalizeIncomeItem({ name: "Primary income", amount: 0 }));
      saveState();
    }

    dom.incomePlanRows.innerHTML = plan.incomeItems.map((item) => `
      <div class="editable-row">
        <div>
          <input type="text" value="${esc(item.name)}" data-kind="income-item" data-id="${esc(item.id)}" data-field="name" placeholder="Income source">
          <div class="mini-label">Source label</div>
        </div>
        <div>
          <input type="number" min="0" step="0.01" value="${item.amount}" data-kind="income-item" data-id="${esc(item.id)}" data-field="amount" placeholder="0.00">
          <div class="mini-label">Amount</div>
        </div>
        <div class="transaction-actions">
          <button type="button" class="icon-ghost" data-action="delete-income-item" data-id="${esc(item.id)}" aria-label="Delete income item">x</button>
        </div>
      </div>
    `).join("");

    dom.incomePlanTotal.textContent = formatMoney(sum(plan.incomeItems, (x) => x.amount));
  }

  function renderGoalAllocations(metrics) {
    const plan = metrics.plan;

    if (!state.goals.length) {
      dom.goalAllocationRows.innerHTML = `<div class="empty-state">No goals created yet. Add a goal to plan monthly contributions.</div>`;
      return;
    }

    const goalAllocMap = new Map(plan.goalAllocations.map((g) => [g.goalId, g]));
    dom.goalAllocationRows.innerHTML = state.goals.map((goal) => {
      const alloc = goalAllocMap.get(goal.id) || createGoalAllocation(goal);
      const remaining = round2(goal.target - goal.saved);
      return `
        <div class="goal-plan-row">
          <div>
            <div><strong>${esc(goal.name)}</strong></div>
            <div class="mini-label">Saved ${esc(formatMoney(goal.saved))} of ${esc(formatMoney(goal.target))} · Remaining ${esc(formatMoney(Math.max(0, remaining)))}</div>
          </div>
          <div>
            <input type="number" min="0" step="0.01" value="${alloc.planned}" data-kind="goal-allocation" data-id="${esc(goal.id)}" data-field="planned">
            <div class="mini-label">Planned this month</div>
          </div>
          <div class="mini-label">${renderGoalDeadlineText(goal)}</div>
        </div>
      `;
    }).join("");
  }

  function renderGoalDeadlineText(goal) {
    if (!goal.deadline) return "No deadline";
    const deadline = parseDateParts(goal.deadline);
    if (!deadline) return "Invalid deadline";
    const now = new Date();
    const diffMs = deadline.date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.ceil(diffMs / 86400000);
    if (days < 0) return "Deadline passed";
    if (days === 0) return "Deadline today";
    return `${days} day(s) left`;
  }

  function renderAllocationTable(metrics) {
    const rows = metrics.rows;
    if (!rows.length) {
      dom.allocationTableBody.innerHTML = `
        <tr>
          <td colspan="11">
            <div class="empty-state">No category allocations yet. Add a template category or click "Apply template defaults".</div>
          </td>
        </tr>
      `;
      return;
    }

    dom.allocationTableBody.innerHTML = rows.map((row) => {
      const varianceClass = row.variance < 0 ? "amount-bad" : row.variance < row.available * 0.1 ? "amount-warn" : "amount-good";
      const remainingClass = row.remaining < 0 ? "amount-bad" : "amount-good";
      const rowPriorityClass = `row-priority ${row.priority}`;
      const template = row.templateId ? getTemplateById(row.templateId) : null;
      return `
        <tr>
          <td>
            <div class="cell-strong">${esc(row.name)}</div>
            <div class="cell-subtle mono">${esc(row.categoryId)}</div>
          </td>
          <td>
            <select data-kind="allocation-row" data-id="${esc(row.id)}" data-field="type">
              <option value="fixed" ${row.type === "fixed" ? "selected" : ""}>Fixed</option>
              <option value="variable" ${row.type === "variable" ? "selected" : ""}>Variable</option>
              <option value="sinking" ${row.type === "sinking" ? "selected" : ""}>Sinking</option>
            </select>
          </td>
          <td>
            <select data-kind="allocation-row" data-id="${esc(row.id)}" data-field="priority">
              <option value="must" ${row.priority === "must" ? "selected" : ""}>Must</option>
              <option value="should" ${row.priority === "should" ? "selected" : ""}>Should</option>
              <option value="nice" ${row.priority === "nice" ? "selected" : ""}>Nice</option>
            </select>
            <div class="${rowPriorityClass}">${esc(row.priority)}</div>
          </td>
          <td>
            <input type="number" min="0" step="0.01" value="${row.planned}" data-kind="allocation-row" data-id="${esc(row.id)}" data-field="planned">
          </td>
          <td>
            <input type="number" min="0" step="0.01" value="${row.carryIn}" data-kind="allocation-row" data-id="${esc(row.id)}" data-field="carryIn">
          </td>
          <td><span class="cell-strong">${esc(formatMoney(row.actual))}</span></td>
          <td><span class="cell-strong ${remainingClass}">${esc(formatMoney(row.remaining))}</span></td>
          <td><span class="cell-subtle">${esc(formatMoney(row.forecast))}</span></td>
          <td><span class="cell-strong ${varianceClass}">${esc(formatMoney(row.variance))}</span></td>
          <td style="text-align:center">
            <input type="checkbox" ${row.rollover ? "checked" : ""} data-kind="allocation-row" data-id="${esc(row.id)}" data-field="rollover">
          </td>
          <td>
            <div class="transaction-actions">
              ${template ? `<button type="button" class="icon-ghost" title="Edit template" data-action="edit-template" data-id="${esc(template.id)}">t</button>` : ""}
              <button type="button" class="icon-ghost" title="Remove row" data-action="delete-allocation-row" data-id="${esc(row.id)}">x</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderTemplateList() {
    const templates = [...state.budgetTemplates].sort(sortTemplates);
    if (!templates.length) {
      dom.templateList.innerHTML = `<div class="empty-state">No templates yet. Add a template to seed future month plans.</div>`;
      return;
    }

    dom.templateList.innerHTML = templates.map((tpl) => `
      <article class="template-card">
        <div class="template-card-head">
          <div>
            <div class="template-card-name">${esc(tpl.name)}</div>
            <div class="template-card-meta">
              <span class="template-meta-pill">${esc(tpl.categoryId)}</span>
              <span class="template-meta-pill">${esc(tpl.type)}</span>
              <span class="template-meta-pill">${esc(tpl.priority)}</span>
              <span class="template-meta-pill">${tpl.rollover ? "rollover on" : "rollover off"}</span>
            </div>
          </div>
          <div class="mono"><strong>${esc(formatMoney(tpl.defaultAmount))}</strong></div>
        </div>
        <div class="template-card-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="edit-template" data-id="${esc(tpl.id)}">Edit</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="template-to-current-month" data-id="${esc(tpl.id)}">Apply to month</button>
          <button type="button" class="btn btn-ghost btn-small" data-action="delete-template" data-id="${esc(tpl.id)}">Delete</button>
        </div>
      </article>
    `).join("");
  }

  function renderTransactions() {
    const key = monthKey();
    let tx = getMonthTransactions(key).slice().sort((a, b) => compareDateStringsDesc(a.date, b.date));

    if (state.ui.txFilter !== "all") {
      tx = tx.filter((t) => t.type === state.ui.txFilter);
    }

    const query = (state.ui.txSearch || "").trim().toLowerCase();
    if (query) {
      tx = tx.filter((t) => {
        return [t.description, t.categoryName, t.note].some((part) =>
          String(part || "").toLowerCase().includes(query)
        );
      });
    }

    document.querySelectorAll('[data-action="set-tx-filter"]').forEach((btn) => {
      btn.classList.toggle("btn-primary", btn.dataset.filter === state.ui.txFilter);
      btn.classList.toggle("btn-ghost", btn.dataset.filter !== state.ui.txFilter);
    });

    renderTransactionList(dom.transactionsList, tx, { compact: false, showActions: true });
  }

  function renderTransactionList(target, tx, options = {}) {
    const { compact = false, showActions = true } = options;
    target.classList.toggle("compact", compact);

    if (!tx.length) {
      target.innerHTML = `<div class="empty-state">No transactions for the active month.</div>`;
      return;
    }

    target.innerHTML = tx.map((item) => {
      const title = item.description || item.categoryName;
      return `
        <div class="transaction-item">
          <div class="transaction-badge ${esc(item.type)}">${item.type === "income" ? "IN" : "OUT"}</div>
          <div class="transaction-main">
            <div class="transaction-title">${esc(title)}</div>
            <div class="transaction-meta">${esc(item.categoryName)} · ${esc(formatDateShort(item.date))}${item.note ? ` · ${esc(item.note)}` : ""}</div>
          </div>
          <div class="transaction-amount ${esc(item.type)}">${item.type === "income" ? "+" : "-"}${esc(formatMoney(item.amount))}</div>
          <div class="transaction-actions">
            ${showActions ? `
              <button type="button" class="icon-ghost" data-action="edit-transaction" data-id="${esc(item.id)}" aria-label="Edit transaction">e</button>
              <button type="button" class="icon-ghost" data-action="delete-transaction" data-id="${esc(item.id)}" aria-label="Delete transaction">x</button>
            ` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderGoals() {
    if (!state.goals.length) {
      dom.goalsList.innerHTML = `<div class="empty-state">No goals yet. Add a savings goal to track progress and monthly contributions.</div>`;
      return;
    }

    const currentPlan = ensureMonthPlan(monthKey());
    const goalAllocMap = new Map(currentPlan.goalAllocations.map((g) => [g.goalId, g]));
    dom.goalsList.innerHTML = state.goals.map((goal) => {
      const progressPct = clamp(goal.saved / goal.target, 0, 1);
      const remaining = Math.max(0, round2(goal.target - goal.saved));
      const alloc = goalAllocMap.get(goal.id);
      const plannedContribution = alloc ? alloc.planned : 0;
      let paceText = "No deadline";
      if (goal.deadline) {
        const parts = parseDateParts(goal.deadline);
        if (parts) {
          const now = new Date();
          const diffDays = Math.ceil((parts.date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
          if (diffDays > 0 && remaining > 0) {
            const monthsLeft = Math.max(1, Math.ceil(diffDays / 30));
            paceText = `Recommended ~${formatMoney(remaining / monthsLeft)} / month`;
          } else if (diffDays <= 0 && remaining > 0) {
            paceText = "Deadline has passed";
          }
        }
      }

      return `
        <article class="goal-card">
          <div class="goal-card-head">
            <div>
              <h4 class="goal-card-title">${esc(goal.name)}</h4>
              <p class="goal-card-sub">${esc(formatMoney(goal.saved))} of ${esc(formatMoney(goal.target))} saved</p>
            </div>
            <div class="transaction-actions">
              <button type="button" class="icon-ghost" data-action="edit-goal" data-id="${esc(goal.id)}" aria-label="Edit goal">e</button>
              <button type="button" class="icon-ghost" data-action="delete-goal" data-id="${esc(goal.id)}" aria-label="Delete goal">x</button>
            </div>
          </div>
          <div class="goal-track"><div class="goal-fill" style="width:${Math.round(progressPct * 100)}%"></div></div>
          <div class="goal-stats">
            <div><strong>${formatPercent(progressPct)}</strong> complete</div>
            <div>Remaining: <strong>${esc(formatMoney(remaining))}</strong></div>
            <div>${esc(goal.deadline ? `Deadline ${goal.deadline}` : "No deadline set")}</div>
            <div>${esc(paceText)}</div>
          </div>
          <div class="goal-inline-form">
            <div class="goal-inline-form-row">
              <label class="field">
                <span>Saved so far</span>
                <input type="number" min="0" step="0.01" value="${goal.saved}" data-kind="goal-inline" data-id="${esc(goal.id)}" data-field="saved">
              </label>
              <label class="field">
                <span>Planned this month</span>
                <input type="number" min="0" step="0.01" value="${plannedContribution}" data-kind="goal-allocation" data-id="${esc(goal.id)}" data-field="planned">
              </label>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderSettings() {
    dom.settingNameInput.value = state.settings.name || "";
    dom.settingCurrencyInput.value = state.settings.currencySymbol || "$";
    dom.settingLocaleInput.value = state.settings.locale || "en-US";
    dom.txSearchInput.value = state.ui.txSearch || "";
  }

  function renderAll() {
    ensureMonthPlan(monthKey());
    renderChrome();
    renderDashboard();
    renderPlanner();
    renderTransactions();
    renderGoals();
    renderSettings();
    refreshTxCategoryOptions();
  }

  function refreshTxCategoryOptions() {
    const type = dom.txTypeInput.value || "expense";
    const options = new Set();
    if (type === "income") {
      for (const c of INCOME_CATEGORY_SUGGESTIONS) options.add(c);
      for (const tx of state.transactions.filter((t) => t.type === "income")) options.add(tx.categoryName);
      for (const item of ensureMonthPlan(monthKey()).incomeItems) options.add(item.name);
    } else {
      for (const tpl of state.budgetTemplates) options.add(tpl.name);
      for (const tx of state.transactions.filter((t) => t.type === "expense")) options.add(tx.categoryName);
    }

    dom.txCategoryOptions.innerHTML = Array.from(options)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((label) => `<option value="${esc(label)}"></option>`)
      .join("");
  }

  function upsertGoalAllocation(goalId, plannedValue) {
    const plan = ensureMonthPlan(monthKey());
    let alloc = plan.goalAllocations.find((g) => g.goalId === goalId);
    if (!alloc) {
      alloc = createGoalAllocation({ id: goalId });
      alloc.goalId = goalId;
      plan.goalAllocations.push(alloc);
    }
    alloc.planned = Math.max(0, round2(plannedValue));
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = "grid";
    modal.hidden = false;
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = "none";
  }

  function closeAllModals() {
    document.querySelectorAll(".modal-backdrop").forEach((modal) => {
      modal.hidden = true;
      modal.style.display = "none";
    });
  }

  function openTransactionModal(txId = null) {
    dom.txForm.reset();
    dom.txEditId.value = "";
    dom.txModalTitle.textContent = txId ? "Edit transaction" : "Add transaction";
    dom.txTypeInput.value = "expense";
    dom.txDateInput.value = todayLocalInputValue();
    dom.txAmountInput.value = "";
    dom.txCategoryInput.value = "";
    dom.txDescriptionInput.value = "";
    dom.txNoteInput.value = "";
    refreshTxCategoryOptions();

    if (txId) {
      const tx = state.transactions.find((t) => t.id === txId);
      if (tx) {
        dom.txEditId.value = tx.id;
        dom.txTypeInput.value = tx.type;
        dom.txDateInput.value = tx.date;
        dom.txAmountInput.value = String(tx.amount);
        dom.txCategoryInput.value = tx.categoryName;
        dom.txDescriptionInput.value = tx.description || "";
        dom.txNoteInput.value = tx.note || "";
        refreshTxCategoryOptions();
      }
    }

    openModal("txModal");
  }

  function openTemplateModal(templateId = null) {
    dom.templateForm.reset();
    dom.templateEditId.value = "";
    dom.templateModalTitle.textContent = templateId ? "Edit template category" : "Template category";
    dom.templateTypeInput.value = "variable";
    dom.templatePriorityInput.value = "should";
    dom.templateAmountInput.value = "";
    dom.templateRolloverInput.checked = false;

    if (templateId) {
      const tpl = state.budgetTemplates.find((t) => t.id === templateId);
      if (tpl) {
        dom.templateEditId.value = tpl.id;
        dom.templateNameInput.value = tpl.name;
        dom.templateTypeInput.value = tpl.type;
        dom.templatePriorityInput.value = tpl.priority;
        dom.templateAmountInput.value = String(tpl.defaultAmount);
        dom.templateRolloverInput.checked = !!tpl.rollover;
      }
    }

    openModal("templateModal");
  }

  function openGoalModal(goalId = null) {
    dom.goalForm.reset();
    dom.goalEditId.value = "";
    dom.goalModalTitle.textContent = goalId ? "Edit savings goal" : "Savings goal";

    if (goalId) {
      const goal = state.goals.find((g) => g.id === goalId);
      if (goal) {
        dom.goalEditId.value = goal.id;
        dom.goalNameInput.value = goal.name;
        dom.goalTargetInput.value = String(goal.target);
        dom.goalSavedInput.value = String(goal.saved);
        dom.goalDeadlineInput.value = goal.deadline || "";
      }
    } else {
      dom.goalSavedInput.value = "0";
    }

    openModal("goalModal");
  }

  function addIncomeItem() {
    const plan = ensureMonthPlan(monthKey());
    plan.incomeItems.push(normalizeIncomeItem({ name: "Income source", amount: 0 }));
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  }

  function addCustomAllocationRow() {
    const plan = ensureMonthPlan(monthKey());
    const baseName = "New category";
    let candidateName = baseName;
    let index = 1;
    while (plan.categoryAllocations.some((r) => r.name.toLowerCase() === candidateName.toLowerCase())) {
      index += 1;
      candidateName = `${baseName} ${index}`;
    }
    plan.categoryAllocations.push(normalizeCategoryAllocation({
      name: candidateName,
      categoryId: slugify(candidateName),
      type: "variable",
      priority: "should",
      planned: 0,
      carryIn: 0,
      rollover: false,
      templateId: null
    }));
    plan.categoryAllocations.sort(sortAllocations);
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    showToast("Added one-off category row to this month.");
  }

  function copyPreviousMonthPlan() {
    const currentKey = monthKey();
    const prev = addMonths(state.currentYear, state.currentMonth, -1);
    const prevKey = monthKey(prev.year, prev.month);
    const previousPlan = state.monthPlans[prevKey];
    if (!previousPlan) {
      showToast("No previous month plan found.");
      return;
    }

    const nextPlan = normalizeMonthPlan(deepClone(previousPlan), currentKey);
    nextPlan.monthKey = currentKey;
    nextPlan.closed = false;
    nextPlan.closedAt = null;
    nextPlan.updatedAt = new Date().toISOString();
    state.monthPlans[currentKey] = nextPlan;
    syncPlanReferences(state.monthPlans[currentKey]);
    saveState();
    renderAll();
    showToast("Copied previous month plan.");
  }

  function applyTemplateDefaultsToMonth() {
    const plan = ensureMonthPlan(monthKey());
    syncPlanReferences(plan, { overwriteTemplateDefaults: true });
    saveState();
    renderAll();
    showToast("Template defaults applied to current month.");
  }

  function applySingleTemplateToCurrentMonth(templateId) {
    const tpl = state.budgetTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const plan = ensureMonthPlan(monthKey());
    const row = plan.categoryAllocations.find((r) => r.categoryId === tpl.categoryId);
    if (row) {
      row.templateId = tpl.id;
      row.name = tpl.name;
      row.type = tpl.type;
      row.priority = tpl.priority;
      row.rollover = tpl.rollover;
      row.planned = tpl.defaultAmount;
    } else {
      plan.categoryAllocations.push(createAllocationFromTemplate(tpl));
      plan.categoryAllocations.sort(sortAllocations);
    }
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    showToast(`Applied ${tpl.name} to the current month plan.`);
  }

  function autoBalancePlan() {
    const metrics = computeMonthMetrics();
    const plan = metrics.plan;

    if (metrics.unallocated > 0) {
      plan.buffer = round2(plan.buffer + metrics.unallocated);
      plan.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
      showToast(`Moved ${formatMoney(metrics.unallocated)} into buffer.`);
      return;
    }

    if (metrics.unallocated < 0 && plan.buffer > 0) {
      const reduction = Math.min(plan.buffer, Math.abs(metrics.unallocated));
      plan.buffer = round2(plan.buffer - reduction);
      plan.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
      showToast(`Reduced buffer by ${formatMoney(reduction)} to rebalance plan.`);
      return;
    }

    showToast("Plan is already balanced or needs manual category changes.");
  }

  function closeMonthAndRollForward() {
    const currentKey = monthKey();
    const metrics = computeMonthMetrics(currentKey);
    const plan = metrics.plan;

    const currentParsed = parseMonthKey(currentKey);
    if (!currentParsed) return;

    const next = addMonths(currentParsed.year, currentParsed.month, 1);
    const nextKey = monthKey(next.year, next.month);
    const nextPlan = ensureMonthPlan(nextKey);

    if (plan.closed && !confirm(`This month is already closed. Re-run rollover into ${formatMonthLabel(next.year, next.month)}?`)) {
      return;
    }

    for (const row of metrics.rows) {
      if (!row.rollover) continue;
      if (row.remaining <= 0) continue;

      let nextRow = nextPlan.categoryAllocations.find((r) => r.categoryId === row.categoryId);
      if (!nextRow) {
        nextRow = normalizeCategoryAllocation({
          templateId: row.templateId,
          categoryId: row.categoryId,
          name: row.name,
          type: row.type,
          priority: row.priority,
          planned: row.templateId ? (getTemplateById(row.templateId)?.defaultAmount ?? row.planned) : row.planned,
          carryIn: 0,
          rollover: row.rollover
        });
        nextPlan.categoryAllocations.push(nextRow);
      }
      nextRow.carryIn = round2(nextRow.carryIn + Math.max(0, row.remaining));
    }

    nextPlan.categoryAllocations.sort(sortAllocations);
    nextPlan.updatedAt = new Date().toISOString();
    plan.closed = true;
    plan.closedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();

    state.currentYear = next.year;
    state.currentMonth = next.month;

    saveState();
    renderAll();
    showToast("Month closed and rollover balances moved forward.");
  }

  function saveTemplateFromForm() {
    const name = dom.templateNameInput.value.trim();
    const defaultAmount = Math.max(0, round2(dom.templateAmountInput.value));
    if (!name) {
      showToast("Template category name is required.");
      return;
    }
    const editingId = dom.templateEditId.value || null;
    const existingTemplate = editingId ? state.budgetTemplates.find((t) => t.id === editingId) : null;
    const categoryId = existingTemplate ? existingTemplate.categoryId : slugify(name);

    const duplicate = state.budgetTemplates.find((t) => t.categoryId === categoryId && t.id !== editingId);
    if (duplicate) {
      showToast(`A template for "${duplicate.name}" already exists. Edit it instead of creating a duplicate.`);
      return;
    }

    const duplicateName = state.budgetTemplates.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== editingId);
    if (duplicateName) {
      showToast(`A template named "${duplicateName.name}" already exists.`);
      return;
    }

    const payload = normalizeTemplate({
      id: editingId || uid("tpl"),
      name,
      categoryId,
      type: dom.templateTypeInput.value,
      priority: dom.templatePriorityInput.value,
      defaultAmount,
      rollover: dom.templateRolloverInput.checked
    });

    if (editingId) {
      const idx = state.budgetTemplates.findIndex((t) => t.id === editingId);
      if (idx >= 0) state.budgetTemplates[idx] = payload;
    } else {
      state.budgetTemplates.push(payload);
    }

    state.budgetTemplates = dedupeTemplates(state.budgetTemplates);
    for (const key of Object.keys(state.monthPlans)) {
      syncPlanReferences(state.monthPlans[key]);
    }
    saveState();
    renderAll();
    closeModal("templateModal");
    showToast(editingId ? "Template updated." : "Template created.");
  }

  function saveTransactionFromForm() {
    const type = dom.txTypeInput.value === "income" ? "income" : "expense";
    const date = dom.txDateInput.value;
    const amount = Math.max(0, round2(dom.txAmountInput.value));
    const categoryNameInput = dom.txCategoryInput.value.trim();
    const description = dom.txDescriptionInput.value.trim();
    const note = dom.txNoteInput.value.trim();

    if (!parseDateParts(date)) {
      showToast("Please enter a valid transaction date.");
      return;
    }
    if (amount <= 0) {
      showToast("Transaction amount must be greater than zero.");
      return;
    }
    if (!categoryNameInput) {
      showToast("Please enter a category.");
      return;
    }

    let categoryName = categoryNameInput;
    let categoryId = slugify(categoryNameInput);
    if (type === "expense") {
      const match = state.budgetTemplates.find((t) => t.name.toLowerCase() === categoryNameInput.toLowerCase() || t.categoryId === slugify(categoryNameInput));
      if (match) {
        categoryName = match.name;
        categoryId = match.categoryId;
      }
    }

    const txPayload = normalizeTransaction({
      id: dom.txEditId.value || uid("tx"),
      type,
      date,
      amount,
      categoryId,
      categoryName,
      description,
      note
    });

    if (dom.txEditId.value) {
      const idx = state.transactions.findIndex((t) => t.id === dom.txEditId.value);
      if (idx >= 0) state.transactions[idx] = txPayload;
    } else {
      state.transactions.push(txPayload);
    }

    saveState();
    renderAll();
    closeModal("txModal");
    showToast(dom.txEditId.value ? "Transaction updated." : "Transaction saved.");
  }

  function saveGoalFromForm() {
    const name = dom.goalNameInput.value.trim();
    const target = Math.max(0, round2(dom.goalTargetInput.value));
    const saved = Math.max(0, round2(dom.goalSavedInput.value || 0));
    const deadline = dom.goalDeadlineInput.value;

    if (!name) {
      showToast("Goal name is required.");
      return;
    }
    if (target <= 0) {
      showToast("Goal target must be greater than zero.");
      return;
    }
    if (deadline && !parseDateParts(deadline)) {
      showToast("Goal deadline is invalid.");
      return;
    }

    const goalPayload = normalizeGoal({
      id: dom.goalEditId.value || uid("goal"),
      name,
      target,
      saved,
      deadline
    });

    if (dom.goalEditId.value) {
      const idx = state.goals.findIndex((g) => g.id === dom.goalEditId.value);
      if (idx >= 0) state.goals[idx] = goalPayload;
    } else {
      state.goals.push(goalPayload);
    }

    state.goals.sort((a, b) => a.name.localeCompare(b.name));
    for (const key of Object.keys(state.monthPlans)) {
      syncPlanReferences(state.monthPlans[key]);
    }
    saveState();
    renderAll();
    closeModal("goalModal");
    showToast(dom.goalEditId.value ? "Goal updated." : "Goal created.");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `budget-atlas-backup-${monthKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Exported JSON backup.");
  }

  function importDataFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const migrated = parsed?.schemaVersion === SCHEMA_VERSION ? normalizeState(parsed) : migrateLegacyState(parsed);
        state = migrated;
        ensureMonthPlan(monthKey(), true);
        saveState();
        renderAll();
        showToast("Data imported successfully.");
      } catch (error) {
        console.error(error);
        showToast("Import failed: invalid JSON or unsupported format.");
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!confirm("Clear all data, including transactions, monthly plans, templates, and goals? This cannot be undone.")) {
      return;
    }
    state = createDefaultState();
    ensureMonthPlan(monthKey(), true);
    saveState();
    renderAll();
    showToast("All data cleared.");
  }

  function handleDocumentClick(event) {
    const target = event.target;

    if (target instanceof HTMLElement && target.classList.contains("modal-backdrop") && target === event.target) {
      target.hidden = true;
      return;
    }

    const navButton = target.closest(".nav-btn[data-page]");
    if (navButton) {
      setActivePage(navButton.dataset.page);
      return;
    }

    const actionEl = target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (!action) return;

    switch (action) {
      case "goto-page":
        if (actionEl.dataset.page) setActivePage(actionEl.dataset.page);
        break;
      case "change-month":
        changeMonthBy(Number(actionEl.dataset.dir || 0));
        break;
      case "open-transaction-modal":
        openTransactionModal();
        break;
      case "open-template-modal":
        openTemplateModal();
        break;
      case "open-goal-modal":
        openGoalModal();
        break;
      case "close-modal":
        if (actionEl.dataset.modal) closeModal(actionEl.dataset.modal);
        break;
      case "set-tx-filter":
        state.ui.txFilter = ["all", "income", "expense"].includes(actionEl.dataset.filter) ? actionEl.dataset.filter : "all";
        saveState();
        renderTransactions();
        break;
      case "copy-prev-plan":
        copyPreviousMonthPlan();
        break;
      case "apply-template-defaults":
        applyTemplateDefaultsToMonth();
        break;
      case "auto-balance-plan":
        autoBalancePlan();
        break;
      case "close-month":
        closeMonthAndRollForward();
        break;
      case "add-income-item":
        addIncomeItem();
        break;
      case "add-custom-allocation-row":
        addCustomAllocationRow();
        break;
      case "delete-income-item":
        deleteIncomeItem(actionEl.dataset.id);
        break;
      case "delete-allocation-row":
        deleteAllocationRow(actionEl.dataset.id);
        break;
      case "edit-template":
        openTemplateModal(actionEl.dataset.id);
        break;
      case "delete-template":
        deleteTemplate(actionEl.dataset.id);
        break;
      case "template-to-current-month":
        applySingleTemplateToCurrentMonth(actionEl.dataset.id);
        break;
      case "edit-transaction":
        openTransactionModal(actionEl.dataset.id);
        break;
      case "delete-transaction":
        deleteTransaction(actionEl.dataset.id);
        break;
      case "edit-goal":
        openGoalModal(actionEl.dataset.id);
        break;
      case "delete-goal":
        deleteGoal(actionEl.dataset.id);
        break;
      case "export-data":
        exportData();
        break;
      case "import-data-click":
        dom.importFileInput.click();
        break;
      case "clear-data":
        clearAllData();
        break;
      default:
        break;
    }
  }

  function deleteIncomeItem(id) {
    const plan = ensureMonthPlan(monthKey());
    if (plan.incomeItems.length === 1) {
      showToast("Keep at least one income row.");
      return;
    }
    plan.incomeItems = plan.incomeItems.filter((item) => item.id !== id);
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  }

  function deleteAllocationRow(id) {
    const plan = ensureMonthPlan(monthKey());
    const row = plan.categoryAllocations.find((r) => r.id === id);
    if (!row) return;
    if (!confirm(`Remove "${row.name}" from this month plan? This does not delete the template.`)) return;
    plan.categoryAllocations = plan.categoryAllocations.filter((r) => r.id !== id);
    plan.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  }

  function deleteTemplate(id) {
    const tpl = state.budgetTemplates.find((t) => t.id === id);
    if (!tpl) return;
    if (!confirm(`Delete template "${tpl.name}"? Existing monthly snapshots will stay unchanged.`)) return;
    state.budgetTemplates = state.budgetTemplates.filter((t) => t.id !== id);
    saveState();
    renderAll();
  }

  function deleteTransaction(id) {
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) return;
    if (!confirm(`Delete ${tx.type} transaction "${tx.description || tx.categoryName}"?`)) return;
    state.transactions = state.transactions.filter((t) => t.id !== id);
    saveState();
    renderAll();
  }

  function deleteGoal(id) {
    const goal = state.goals.find((g) => g.id === id);
    if (!goal) return;
    if (!confirm(`Delete goal "${goal.name}"? Monthly goal contributions for this goal will also be removed.`)) return;
    state.goals = state.goals.filter((g) => g.id !== id);
    for (const key of Object.keys(state.monthPlans)) {
      const plan = state.monthPlans[key];
      plan.goalAllocations = plan.goalAllocations.filter((g) => g.goalId !== id);
      plan.updatedAt = new Date().toISOString();
    }
    saveState();
    renderAll();
  }

  function handleDocumentChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;

    if (target === dom.txTypeInput) {
      refreshTxCategoryOptions();
      return;
    }

    if (target === dom.importFileInput) {
      const file = target.files && target.files[0];
      if (file) importDataFromFile(file);
      target.value = "";
      return;
    }

    if (target === dom.planBufferInput || target === dom.planSavingsTargetInput || target === dom.planNotesInput) {
      const plan = ensureMonthPlan(monthKey());
      plan.buffer = Math.max(0, round2(dom.planBufferInput.value || 0));
      plan.savingsTarget = Math.max(0, round2(dom.planSavingsTargetInput.value || 0));
      plan.notes = dom.planNotesInput.value;
      plan.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
      return;
    }

    if (target === dom.settingNameInput || target === dom.settingCurrencyInput || target === dom.settingLocaleInput) {
      state.settings.name = dom.settingNameInput.value.trim();
      state.settings.currencySymbol = (dom.settingCurrencyInput.value.trim() || "$").slice(0, 4);
      state.settings.locale = dom.settingLocaleInput.value.trim() || "en-US";
      saveState();
      renderAll();
      return;
    }

    const kind = target.dataset.kind;
    if (!kind) return;

    if (kind === "income-item") {
      const plan = ensureMonthPlan(monthKey());
      const item = plan.incomeItems.find((x) => x.id === target.dataset.id);
      if (!item) return;
      if (target.dataset.field === "name") item.name = target.value.trim() || "Income";
      if (target.dataset.field === "amount") item.amount = Math.max(0, round2(target.value || 0));
      plan.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
      return;
    }

    if (kind === "allocation-row") {
      const plan = ensureMonthPlan(monthKey());
      const row = plan.categoryAllocations.find((x) => x.id === target.dataset.id);
      if (!row) return;
      const field = target.dataset.field;
      if (field === "type") row.type = ["fixed", "variable", "sinking"].includes(target.value) ? target.value : row.type;
      if (field === "priority") row.priority = ["must", "should", "nice"].includes(target.value) ? target.value : row.priority;
      if (field === "planned") row.planned = Math.max(0, round2(target.value || 0));
      if (field === "carryIn") row.carryIn = Math.max(0, round2(target.value || 0));
      if (field === "rollover" && target instanceof HTMLInputElement) row.rollover = target.checked;
      plan.categoryAllocations.sort(sortAllocations);
      plan.updatedAt = new Date().toISOString();
      saveState();
      renderAll();
      return;
    }

    if (kind === "goal-allocation") {
      upsertGoalAllocation(target.dataset.id || "", target.value);
      return;
    }

    if (kind === "goal-inline") {
      const goal = state.goals.find((g) => g.id === target.dataset.id);
      if (!goal) return;
      if (target.dataset.field === "saved") {
        goal.saved = Math.max(0, round2(target.value || 0));
      }
      saveState();
      renderAll();
    }
  }

  function handleDocumentInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    if (target === dom.txSearchInput) {
      state.ui.txSearch = target.value;
      saveState();
      renderTransactions();
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("change", handleDocumentChange);
    document.addEventListener("input", handleDocumentInput);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllModals();
    });

    if (dom.mobileMenuButton) {
      dom.mobileMenuButton.addEventListener("click", () => {
        document.body.classList.toggle("nav-open");
      });
    }

    if (dom.txForm) {
      dom.txForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveTransactionFromForm();
      });
    }

    if (dom.templateForm) {
      dom.templateForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveTemplateFromForm();
      });
    }

    if (dom.goalForm) {
      dom.goalForm.addEventListener("submit", (event) => {
        event.preventDefault();
        saveGoalFromForm();
      });
    }

    document.querySelectorAll(".modal-backdrop").forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) modal.hidden = true;
      });
    });
  }

  function init() {
    cacheDom();
    loadState();
    bindEvents();
    closeAllModals();
    setActivePage(state.ui.activePage || "dashboard");
    renderAll();
  }

  init();
})();
