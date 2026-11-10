(function () {
  "use strict";
  const C = window.SC_CONFIG, Q = window.SC_QUESTIONS, LOC = window.SC_LOCATIONS, SAMPLES = window.SC_SAMPLES || [];
  const app = document.getElementById("app"), nav = document.getElementById("nav"), tabs = document.getElementById("tabs");

  if (!window.supabase) {
    app.innerHTML = '<div class="msg">We couldn\'t load the sign-in service. Check your connection and refresh the page.</div>';
    return;
  }
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);

  let session = null, profile = null, quiz = null, recovering = false, renderId = 0, chatChannel = null, chatPoll = null, unread = 0;

  // ---------- problem logging (shows on the Admin page) ----------
  const seenErr = new Set();
  function logErr(where, err) {
    try {
      const msg = String((err && (err.message || err.reason && err.reason.message)) || err || "unknown").slice(0, 400);
      const key = where + "|" + msg;
      if (seenErr.has(key) || seenErr.size > 8) return; seenErr.add(key);
      sb.from("client_errors").insert({
        page: (location.hash || "#/").slice(0, 120), message: (where + ": " + msg).slice(0, 500),
        detail: String((err && err.stack) || "").slice(0, 2000), agent: navigator.userAgent.slice(0, 300)
      }).then(() => {}, () => {});
    } catch (e) {}
  }
  window.addEventListener("error", e => logErr("script", e.error || e.message));
  window.addEventListener("unhandledrejection", e => logErr("promise", e.reason));
  let lastTouch = 0;
  function touch() { if (session && Date.now() - lastTouch > 120000) { lastTouch = Date.now(); sb.rpc("touch").then(() => {}, () => {}); } }

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);
  const route = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "");
  const param = k => new URLSearchParams(location.hash.split("?")[1] || "").get(k);
  const go = r => { if (location.hash === "#/" + r) render(); else location.hash = "#/" + r; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  function toast(t) {
    const e = document.createElement("div"); e.className = "toast"; e.setAttribute("role", "status"); e.textContent = t;
    document.body.appendChild(e); setTimeout(() => e.remove(), 2600);
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "One moment…"; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function ageFrom(d) {
    if (!d) return null;
    const b = new Date(d + "T00:00:00"), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  const fmtDate = d => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const fmtTime = d => {
    const t = new Date(d), today = new Date().toDateString() === t.toDateString();
    return today ? t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const answered = () => quiz ? Q.filter(q => quiz.answers && quiz.answers[q.id]).length : 0;
  const profileDone = () => !!(profile && profile.completed_at);
  const quizDone = () => !!(quiz && quiz.completed_at);
  const isAdmin = () => !!(profile && profile.is_admin);
  const isFounder = () => !!(profile && profile.founder_number);
  const memberActive = () => !!(profile && (isAdmin() || (profile.founder_free_until && new Date(profile.founder_free_until) > new Date()) || (profile.paid_until && new Date(profile.paid_until) > new Date())));
  const friendly = e => {
    const m = (e && e.message) || "";
    if (/invalid login/i.test(m)) return "Email or password is incorrect. Check both and try again.";
    if (/already registered/i.test(m)) return "That email already has an account. Sign in instead.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for the link we sent.";
    if (/rate limit/i.test(m)) return "Too many attempts in a short time. Wait a few minutes and try again.";
    if (/password/i.test(m)) return m;
    return "Something went wrong on our end. Please try again.";
  };
  const HEART = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>';

  // ---------- photos ----------
  const urlCache = {};
  async function photoUrl(path, bucket) {
    bucket = bucket || "photos";
    if (!path) return null;
    if (path.startsWith("samples/")) return path;
    const key = bucket + ":" + path, hit = urlCache[key];
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
    if (error || !data) return null;
    urlCache[key] = { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 };
    return data.signedUrl;
  }
  function hydrateBooth(root) {
    (root || document).querySelectorAll("[data-booth]").forEach(async el => {
      const path = el.dataset.booth; el.removeAttribute("data-booth");
      const url = await photoUrl(path, "booth");
      if (url) el.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Photo booth picture"></a>`;
    });
  }

  // ---------- server programs (payments, photo booth) ----------
  async function fn(name, body) {
    try {
      const { data, error } = await sb.functions.invoke(name, { body });
      if (error) {
        let detail = null;
        try { detail = error.context && typeof error.context.json === "function" ? await error.context.json() : null; } catch (e) {}
        return { data: detail, error };
      }
      return { data, error: null };
    } catch (e) { return { data: null, error: e }; }
  }
  let billingCfg = null, boothCfgV = null;
  async function getBilling() {
    if (billingCfg) return billingCfg;
    const { data, error } = await fn("billing", { action: "status" });
    const v = !error && data && data.configured ? data : { configured: false };
    if (!error) billingCfg = v;
    return v;
  }
  async function boothCfg() {
    if (boothCfgV) return boothCfgV;
    const { data, error } = await fn("booth", { action: "status" });
    const v = !error && data && data.configured ? data : { configured: false };
    if (!error) boothCfgV = v;
    return v;
  }
  const PRICES = { week: "$9.99 a week", month: "$36 a month" };
  function memberStatus() {
    const p = profile || {};
    const live = p.sub_id && ["active", "trialing", "past_due"].includes(p.sub_status);
    if (live) {
      const price = PRICES[p.sub_plan] || "your plan's price";
      if (p.sub_status === "past_due") return `<p><strong>Your last payment didn't go through.</strong> Update your card to keep your membership.</p>`;
      if (p.sub_cancel_at_period_end) return `<p><strong>Canceled.</strong> You keep access until ${fmtDate(p.paid_until)}, and you won't be charged again.</p>`;
      if (p.sub_status === "trialing") return `<p><strong>Free until ${fmtDate(p.paid_until)}</strong>, then ${price}, renewing automatically until you cancel.</p>`;
      return `<p><strong>Member.</strong> ${price}, renews ${fmtDate(p.paid_until)}.</p>`;
    }
    if (isFounder() && memberActive() && !isAdmin()) return `<p><strong>Founding member #${p.founder_number}.</strong> Free until ${fmtDate(p.founder_free_until)}. Choose a plan before then to keep your introductions coming.</p>`;
    if (p.paid_until && new Date(p.paid_until) > new Date()) return `<p><strong>Member</strong> through ${fmtDate(p.paid_until)}.</p>`;
    if (isAdmin()) return `<p><strong>Administrator.</strong> No membership needed.</p>`;
    return `<p>No active membership.</p>`;
  }
  function memberButtons() {
    const p = profile || {}, b = [];
    const live = p.sub_id && ["active", "trialing", "past_due"].includes(p.sub_status);
    if (live && !p.sub_cancel_at_period_end) b.push('<button type="button" class="btn ghost" data-bill="cancel">Cancel membership</button>');
    if (live && p.sub_cancel_at_period_end) b.push('<button type="button" class="btn ghost" data-bill="resume">Keep my membership</button>');
    if (p.stripe_customer_id) b.push('<button type="button" class="btn ghost" data-bill="portal">Update card or see receipts</button>');
    if (!live && profileDone() && !isAdmin()) b.push('<a class="btn ghost" href="#/membership">Choose a plan</a>');
    return b.length ? `<div class="row tight">${b.join("")}</div>` : "";
  }
  // Fill every [data-photo] placeholder on the page with its picture.
  function hydratePhotos(root) {
    (root || document).querySelectorAll("[data-photo]").forEach(async el => {
      const path = el.dataset.photo; el.removeAttribute("data-photo");
      const url = await photoUrl(path);
      if (url) { const img = new Image(); img.alt = ""; img.src = url; img.onload = () => { el.innerHTML = ""; el.appendChild(img); }; }
    });
  }
  // Round portrait. Founders get the crimson ring, gold ring and crimson sickle with the golden SC.
  function avatar(c, size, opts) {
    opts = opts || {};
    const initial = esc((c.first_name || c.name || "?").charAt(0));
    const inner = `<div class="ph${opts.sample ? " sample" : ""}" ${c.photo_path ? `data-photo="${esc(c.photo_path)}"` : ""}><span>${initial}</span></div>`;
    if (!c.founder) return `<div class="av" style="--s:${size}px">${inner}</div>`;
    return `<div class="av fb" style="--s:${size}px" title="Founding member">${inner}${badgeSvg()}</div>`;
  }
  function badgeSvg() {
    return `<svg class="badge" viewBox="0 0 120 132" aria-hidden="true">
      <circle cx="60" cy="60" r="49" fill="none" stroke="#b0122b" stroke-width="6"/>
      <circle cx="60" cy="60" r="55.5" fill="none" stroke="#f2c230" stroke-width="5"/>
      <path d="M18 92 Q60 140 102 92 Q60 122 18 92 Z" fill="#b0122b" stroke="#f2c230" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="60" cy="117" r="13.5" fill="#b0122b" stroke="#f2c230" stroke-width="2.5"/>
      <text x="60" y="122" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" font-size="14" fill="#f2c230">SC</text>
    </svg>`;
  }
  async function resizeImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1080, scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise(res => cv.toBlob(res, "image/jpeg", 0.85));
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- data ----------
  async function loadMine() {
    if (!session) { profile = null; quiz = null; return; }
    const uid = session.user.id;
    const [p, q] = await Promise.all([
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      sb.from("questionnaire").select("*").eq("user_id", uid).maybeSingle()
    ]);
    profile = p.data || null;
    quiz = q.data || { user_id: uid, answers: {}, completed_at: null };
  }
  async function refreshUnread() {
    if (!session || !profileDone()) { unread = 0; return; }
    const { data } = await sb.rpc("my_matches");
    unread = (data || []).reduce((n, m) => n + (+m.unread || 0), 0);
    renderTabs();
  }

  // Count visits (no outside tracking service). One random id per browser.
  const logged = new Set();
  function logVisit(r) {
    const key = r || "home";
    if (logged.has(key)) return; logged.add(key);
    let v = store.get("sc_v");
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("sc_v", v); }
    sb.from("visits").insert({ visitor: v.slice(0, 40), path: key.slice(0, 80) }).then(() => {}, () => {});
  }

  // ---------- navigation ----------
  function renderNav() {
    nav.innerHTML = session ? "" : '<a href="#/signin">Sign in</a>';
    renderTabs();
  }
  function renderTabs() {
    const show = session && !recovering;
    document.body.classList.toggle("has-tabs", !!show);
    if (!show) { tabs.innerHTML = ""; return; }
    const r = route(), on = x => (r === x || (x === "matches" && r === "chat")) ? ' aria-current="page"' : "";
    tabs.innerHTML = `
      <a href="#/home"${on("home")}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>Today</a>
      <a href="#/matches"${on("matches")}>${HEART}Matches${unread ? `<b class="dot">${unread}</b>` : ""}</a>
      <a href="#/profile"${on("profile")}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z"/></svg>Profile</a>
      ${isAdmin() ? `<a href="#/admin"${on("admin")}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z"/></svg>Admin</a>` : ""}`;
  }

  // ---------- views (return HTML, or a promise of HTML) ----------
  const views = {};

  views[""] = () => `
    <section class="hero">
      <p class="eyebrow">Now forming in the Tulsa area</p>
      <h1>Fewer introductions. Better ones.</h1>
      <p class="lead">Second Chapter is matchmaking for singles 40 and over. No swiping and no endless feed, just a few people chosen for you each day.</p>
    </section>
    <ol class="steps">
      <li>Create your profile and answer 20 questions about what matters to you.</li>
      <li>Every 24 hours, our matching chooses five people for you.</li>
      <li>Missed a day? Up to five past matches wait in your match cart.</li>
      <li>When you both say yes, messaging opens for the two of you.</li>
    </ol>
    <div class="founder"><div class="founder-row">${avatar({ first_name: "S", founder: true }, 64, { sample: true })}<div><strong>Founding members</strong><br>The first 100 people to complete a profile get two months free and a founder's badge.<span id="spots"></span></div></div></div>
    <div class="row"><a class="btn" href="#/signup">Create your profile</a><a class="btn ghost" href="#/signin">Sign in</a></div>
    <h3>What an introduction looks like</h3>
    <p class="hint" style="margin-top:0">These are sample profiles, not real members.</p>
    <div class="samples">${SAMPLES.map(s => `
      <article class="card intro sample-card">
        <div class="who">${avatar({ first_name: s.name, photo_path: s.photo || null }, 72, { sample: true })}
          <div><h4>${esc(s.name)}, ${s.age}</h4><p class="meta">${esc(s.city)}</p></div>
          <span class="score">${s.score}%</span></div>
        <p class="bio">${esc(s.bio)}</p>
        <span class="tag">Sample profile</span>
      </article>`).join("")}</div>
    <h3>Membership</h3>
    <div class="price"><div><strong>$9.99</strong>per week</div><div><strong>$36</strong>per month</div></div>
    <p class="hint">Cancel anytime. See <a href="pricing.html">pricing</a> and <a href="refunds.html">refunds</a>.</p>`;
  views[""].after = async () => {
    hydratePhotos();
    const { data } = await sb.rpc("founder_spots_left");
    if (typeof data === "number" && $("spots")) $("spots").textContent = data > 0 ? ` ${data} of 100 spots left.` : " All 100 founder spots are taken.";
  };

  views.signup = () => authForm("up");
  views.signin = () => authForm("in");
  views.forgot = () => `
    <h2>Reset your password</h2>
    <p class="sub">We'll email you a link to choose a new one.</p>
    <form id="forgotf" novalidate>
      <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
      <p class="err" id="err" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Send reset link</button><a class="btn ghost" href="#/signin">Back to sign in</a></div>
    </form>`;
  views.newpass = () => `
    <h2>Choose a new password</h2>
    <form id="newpassf" novalidate>
      <label for="pw">New password <span class="hint">(at least 8 characters)</span></label>
      <input id="pw" type="password" autocomplete="new-password" required>
      <p class="err" id="err" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Save password</button></div>
    </form>`;

  views.profile = () => {
    const p = profile || {}, other = p.city && !LOC.includes(p.city);
    const sel = (v, x) => v === x ? ' aria-pressed="true"' : ' aria-pressed="false"';
    return `
    <h2>${profileDone() ? "Your profile" : "Tell us about you"}</h2>
    <p class="sub">Your matches see your photo, first name, age, town and bio. Never your email or birthday.</p>
    ${isFounder() ? `<div class="founder"><strong>Founding member #${p.founder_number}.</strong> Your membership is free until ${fmtDate(p.founder_free_until)}.</div>` : ""}
    <div class="photo-edit">
      <div id="myphoto">${avatar({ first_name: p.first_name || "+", photo_path: p.photo_path, founder: isFounder() }, 120)}</div>
      <div>
        <label class="btn ghost file" for="photoin">${p.photo_path ? "Change photo" : "Add your photo"}</label>
        <input id="photoin" type="file" accept="image/*" hidden>
        <p class="hint" id="photomsg">A clear, recent photo of just you, face visible.</p>
      </div>
    </div>
    <form id="proff" novalidate>
      <label for="nm">First name</label>
      <input id="nm" value="${esc(p.first_name)}" autocomplete="given-name" maxlength="30">
      <div class="lbl" id="bdl">Date of birth <span class="hint">(members must be ${C.minAge} or older)</span></div>
      <div class="dob" role="group" aria-labelledby="bdl">
        <div><label for="bm" class="hint">Month</label><input id="bm" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="MM" autocomplete="bday-month" value="${p.birthdate ? +p.birthdate.slice(5, 7) : ""}"></div>
        <div><label for="bdd" class="hint">Day</label><input id="bdd" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="DD" autocomplete="bday-day" value="${p.birthdate ? +p.birthdate.slice(8, 10) : ""}"></div>
        <div><label for="by" class="hint">Year</label><input id="by" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="YYYY" autocomplete="bday-year" value="${p.birthdate ? p.birthdate.slice(0, 4) : ""}"></div>
      </div>
      <div class="lbl" id="gl">I am a</div>
      <div class="seg" role="group" aria-labelledby="gl" data-field="gender">
        <button type="button" data-val="man"${sel(p.gender, "man")}>Man</button>
        <button type="button" data-val="woman"${sel(p.gender, "woman")}>Woman</button>
      </div>
      <div class="lbl" id="sl">Interested in</div>
      <div class="seg" role="group" aria-labelledby="sl" data-field="seeking">
        <button type="button" data-val="men"${sel(p.seeking, "men")}>Men</button>
        <button type="button" data-val="women"${sel(p.seeking, "women")}>Women</button>
        <button type="button" data-val="everyone"${sel(p.seeking, "everyone")}>Everyone</button>
      </div>
      <label for="loc">Where do you live?</label>
      <select id="loc">
        <option value="">Choose your town</option>
        <optgroup label="Tulsa area">${LOC.map(c => `<option${p.city === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</optgroup>
        <option value="__other"${other ? " selected" : ""}>Somewhere else</option>
      </select>
      <div id="otherloc" ${other ? "" : "hidden"}>
        <p class="hint">We're starting in Tulsa, but you're welcome to join now. We'll introduce you as members join near you.</p>
        <div class="two">
          <div><label for="oc" style="margin-top:0">City</label><input id="oc" maxlength="80" value="${other ? esc(p.city) : ""}" autocomplete="address-level2"></div>
          <div><label for="os" style="margin-top:0">State</label><input id="os" maxlength="40" value="${other ? esc(p.state) : ""}" autocomplete="address-level1"></div>
        </div>
      </div>
      <label for="bio">A short bio</label>
      <textarea id="bio" maxlength="${C.textLimit}" placeholder="A few lines about you and what a good day looks like.">${esc(p.bio)}</textarea>
      <div class="count" id="cnt">${(p.bio || "").length}/${C.textLimit}</div>
      <p class="err" id="err" role="alert"></p>
      <div class="row"><button class="btn" type="submit">${profileDone() ? "Save changes" : "Save and continue"}</button></div>
    </form>
    <div class="account">
      ${profileDone() ? `<h3>Membership</h3>${memberStatus()}${memberButtons()}` : ""}
      <h3>Photo booth</h3>
      <div class="toggles">
        <label><input type="checkbox" data-pref="booth_ok"${p.booth_ok ? " checked" : ""}> Let my matches and me make AI pictures of the two of us together</label>
      </div>
      <p class="hint">Off unless you turn it on. Both people in a match must turn it on. Pictures use each person's profile photo, carry a Second Chapter watermark, and are deleted for both of you if you unmatch.</p>
      <h3>Email me when</h3>
      <div class="toggles">
        <label><input type="checkbox" data-pref="email_matches"${p.email_matches === false ? "" : " checked"}> Someone matches with me</label>
        <label><input type="checkbox" data-pref="email_messages"${p.email_messages === false ? "" : " checked"}> A match sends me a message</label>
        <label><input type="checkbox" data-pref="email_glints"${p.email_glints === false ? "" : " checked"}> Someone sends me a glint</label>
      </div>
      <p class="hint">We never put your messages in emails, only that you have one. If you're on the site, we don't email you about new messages.</p>
      <p><a href="safety.html">Safety tips for meeting in person</a></p>
      <p class="hint">Signed in as ${esc(session.user.email)}</p>
      <div class="row"><button type="button" class="btn ghost" data-act="out">Sign out</button></div>
      ${quizDone() ? '<p><a href="#/questions?q=1">Review your 20 answers</a></p>' : ""}
      <p><a href="#/feedback">Report a problem</a></p>
      <p><button type="button" class="linkbtn danger" data-act="delete">Delete my account</button></p>
    </div>`;
  };
  views.profile.after = () => hydratePhotos();

  views.feedback = () => `
    <h2>Report a problem</h2>
    <p class="sub">Something not working, confusing, or wrong? Tell us what happened and we'll look into it.</p>
    <form id="feedbackf" novalidate>
      <label for="fb">What happened?</label>
      <textarea id="fb" maxlength="${C.textLimit}" placeholder="For example: I tapped Save and nothing happened."></textarea>
      <div class="count" id="cnt">0/${C.textLimit}</div>
      ${session ? "" : `<label for="fbc">Your email <span class="hint">(optional, if you'd like a reply)</span></label><input id="fbc" type="email" maxlength="120" autocomplete="email">`}
      <p class="err" id="err" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Send</button><a class="btn ghost" href="#/${session ? "home" : ""}">Cancel</a></div>
    </form>
    <p class="hint">For safety concerns about a member, use the Report button on their profile. In an emergency, call 911.</p>`;

  views.membership = async () => {
    const p = profile || {};
    if (param("paid") === "1") return `<h2>Finishing up…</h2><p class="sub">We're confirming your payment with Stripe. This usually takes a few seconds.</p><p class="loading" id="paidwait">Waiting for confirmation…</p>`;
    const billing = await getBilling();
    const live = p.sub_id && ["active", "trialing", "past_due"].includes(p.sub_status);
    const nextDate = isFounder() && memberActive() ? p.founder_free_until : (p.paid_until && new Date(p.paid_until) > new Date() ? p.paid_until : null);
    const plans = billing.configured ? `
      <label class="hint agree"><input id="renew" type="checkbox"> <span>I understand my membership renews automatically at the price I choose, every week or every month, until I cancel. I can cancel anytime from my Profile page and keep access until the end of the period I paid for. No refunds for partial periods.${nextDate ? ` I won't be charged until ${fmtDate(nextDate)}.` : ""}</span></label>
      <div class="plans">
        <div class="card plan"><strong>$9.99</strong><span>per week</span><button class="btn" data-plan="week">Choose weekly</button></div>
        <div class="card plan best"><em>Best value</em><strong>$36</strong><span>per month</span><button class="btn" data-plan="month">Choose monthly</button></div>
      </div>
      <p class="err" id="err" role="alert"></p>
      <p class="hint">Payment is handled securely by Stripe. See <a href="pricing.html">pricing</a> and <a href="refunds.html">refunds</a>.</p>` : `
      <div class="plans">
        <div class="card plan"><strong>$9.99</strong><span>per week</span><button class="btn" disabled>Coming soon</button></div>
        <div class="card plan best"><em>Best value</em><strong>$36</strong><span>per month</span><button class="btn" disabled>Coming soon</button></div>
      </div>
      <div class="msg">Online payment is opening shortly. Your profile is saved, so you can come back and pick up right here.</div>
      <p class="hint">Cancel anytime. No refunds for partial periods. See <a href="pricing.html">pricing</a> and <a href="refunds.html">refunds</a>.</p>`;
    if (live) return `
      <h2>Your membership</h2>${memberStatus()}
      <div class="row"><a class="btn" href="#/${quizDone() ? "home" : "questions"}">${quizDone() ? "Back to today" : "Continue to the 20 questions"}</a><a class="btn ghost" href="#/profile">Manage membership</a></div>`;
    if (isFounder() && memberActive()) return `
      <h2>You're a founding member</h2>
      <div class="founder-row big">${avatar({ first_name: p.first_name, photo_path: p.photo_path, founder: true }, 110)}
        <div><strong>Founder #${p.founder_number}</strong><br>Free until ${fmtDate(p.founder_free_until)}</div></div>
      <p>Your badge shows on your profile to everyone you're introduced to.</p>
      <div class="row"><a class="btn" href="#/${quizDone() ? "home" : "questions"}">${quizDone() ? "Back to today" : "Continue to the 20 questions"}</a></div>
      <h3>After your free months</h3>
      <p>Membership is $9.99 a week or $36 a month. ${billing.configured ? "You can pick a plan now and won't be charged until your free time ends, or come back any time before then." : "You'll be able to pick a plan here before your free time ends."}</p>
      ${billing.configured ? plans : ""}`;
    const lapsed = (p.founder_free_until || p.paid_until) && !memberActive();
    return `
      <h2>${lapsed ? "Renew your membership" : "Choose your membership"}</h2>
      <p class="sub">${lapsed ? "Your membership has ended. Renew to keep getting introductions." : "All 100 founder spots have been claimed. Membership unlocks the 20 questions and your daily introductions."}</p>
      ${plans}`;
  };
  views.membership.after = async () => {
    hydratePhotos();
    if (param("paid") !== "1") return;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      if (route() !== "membership") return;
      await loadMine();
      if (profile && profile.sub_id) { toast("You're all set. Thank you!"); go(quizDone() ? "home" : "questions"); return; }
    }
    const w = $("paidwait");
    if (w) w.innerHTML = 'Stripe has your payment, but our confirmation is running slow. <a href="#/profile">Check your membership</a> in a minute, or <a href="#/feedback">tell us</a> if it doesn\'t show up.';
  };

  views.questions = () => {
    const a = (quiz && quiz.answers) || {};
    let i = +(param("q") || 0);
    if (!(i >= 1 && i <= Q.length)) { const f = Q.findIndex(q => !a[q.id]); i = (f < 0 ? Q.length - 1 : f) + 1; }
    const q = Q[i - 1], n = answered();
    return `
    <p class="qnum">Question ${i} of ${Q.length} · ${n} answered</p>
    <div class="bar" aria-hidden="true"><span style="width:${(n / Q.length) * 100}%"></span></div>
    <h2 class="qtext" id="qt">${esc(q.text)}</h2>
    <div class="opts" role="group" aria-labelledby="qt">
      ${q.options.map(([id, t]) => `<button type="button" data-ans="${q.id}:${id}" data-i="${i}" aria-pressed="${a[q.id] === id}">${esc(t)}</button>`).join("")}
    </div>
    <p class="err" id="err" role="alert"></p>
    <div class="row">
      ${i > 1 ? `<a class="btn ghost" href="#/questions?q=${i - 1}">Back</a>` : ""}
      ${a[q.id] && i < Q.length ? `<a class="btn ghost" href="#/questions?q=${i + 1}">Next</a>` : ""}
      <a class="btn ghost" href="#/home">Finish later</a>
    </div>`;
  };

  function setupSteps() {
    const n = answered(), pd = profileDone(), ma = memberActive(), qd = quizDone();
    const step = (title, sub, done, href, label, enabled) => `
      <div class="card check"><div><strong>${title}</strong>${sub ? `<div class="st">${sub}</div>` : ""}</div>
      ${done ? '<span class="st done">Done ✓</span>' : `<a class="btn${enabled ? "" : " ghost"}" href="${href}">${label}</a>`}</div>`;
    return `
      <h2>Hello${profile && profile.first_name ? ", " + esc(profile.first_name) : ""}</h2>
      <p class="sub">A few steps and you're ready for introductions.</p>
      ${step("Your profile and photo", "", pd, "#/profile", profile ? "Finish" : "Start", true)}
      ${step("Membership", isFounder() ? `Founder #${profile.founder_number}, free for 2 months` : (pd ? "" : "Founder spots are claimed when your profile is complete"), pd && ma, "#/membership", "Choose", pd)}
      ${step("The 20 questions", `${n} of ${Q.length} answered`, qd, "#/questions", n ? "Continue" : "Start", pd && ma)}`;
  }

  views.home = async () => {
    if (!profileDone() || !memberActive() || !quizDone()) {
      if (profileDone() && !memberActive() && quizDone()) return views.membership();
      return setupSteps();
    }
    const { data, error } = await sb.rpc("my_introductions");
    if (error) logErr("introductions", error);
    if (error) return `<div class="msg">We couldn't load your introductions. Pull down to refresh, or try again in a minute.</div>`;
    const today = data.filter(x => x.section === "today" && x.card), cart = data.filter(x => x.section === "cart" && x.card);
    const away = profile.state && !/^(ok|oklahoma)$/i.test(profile.state.trim());
    const empty = `<div class="card"><h4>No new introductions today</h4><p>${away
      ? "We're starting in the Tulsa area. As members join near you, your introductions will start arriving here."
      : "We pick people who fit your answers, so some days there are fewer. New introductions arrive every morning."}</p></div>`;
    return `
      <h2>Today's introductions</h2>
      <p class="sub">${today.length ? "Chosen for you this morning. Take your time." : "New introductions arrive every morning."}</p>
      ${today.length ? today.map(introCard).join("") : empty}
      ${cart.length ? `<h3>Your match cart</h3><p class="hint" style="margin-top:0">Introductions from earlier days you haven't answered yet. The cart holds 5.</p>${cart.map(introCard).join("")}` : ""}`;
  };
  views.home.after = () => hydratePhotos();

  function introCard(x) {
    const c = x.card;
    const actions = x.status === "new" ? `
        <div class="row"><button class="btn" data-yes="${x.intro_id}">I'm interested</button><button class="btn ghost" data-pass="${x.intro_id}">Pass</button></div>`
      : x.status === "interested" ? `<p class="ok">You said yes. If ${esc(c.first_name)} says yes too, messaging opens.</p>`
      : `<p class="hint">You passed.</p>`;
    return `
      <article class="card intro${x.status === "passed" ? " faded" : ""}" id="i${x.intro_id}">
        ${x.glinted_me ? `<p class="glinted">${HEART} ${esc(c.first_name)} sent you a glint</p>` : ""}
        <div class="who">${avatar(c, 84)}
          <div><h4>${esc(c.first_name)}, ${c.age}</h4><p class="meta">${esc(c.city)}${c.founder ? " · Founding member" : ""}</p></div>
          <span class="score" title="How well your answers fit">${x.score}%</span></div>
        <p class="bio">${esc(c.bio)}</p>
        ${actions}
        <div class="minor">
          ${x.status !== "passed" ? (x.i_glinted ? `<span class="hint">${HEART} Glint sent</span>` : `<button type="button" class="linkbtn glint" data-glint="${c.id}" data-name="${esc(c.first_name)}">${HEART} Send a glint</button>`) : "<span></span>"}
          <button type="button" class="linkbtn" data-report="${c.id}" data-name="${esc(c.first_name)}">Report</button>
        </div>
      </article>`;
  }

  views.matches = async () => {
    const { data, error } = await sb.rpc("my_matches");
    if (error) logErr("matches", error);
    if (error) return `<div class="msg">We couldn't load your matches. Try again in a minute.</div>`;
    unread = data.reduce((n, m) => n + (+m.unread || 0), 0);
    return `
      <h2>Your matches</h2>
      <p class="sub">When you and someone both say yes, you can message each other here.</p>
      ${data.length ? data.filter(m => m.card).map(m => `
        <a class="card matchrow" href="#/chat?m=${m.match_id}">
          ${avatar(m.card, 56)}
          <div class="mid"><strong>${esc(m.card.first_name)}</strong><span>${m.last ? esc(m.last) : "Say hello"}</span></div>
          <div class="end"><small>${fmtTime(m.last_at)}</small>${+m.unread ? `<b class="dot">${m.unread}</b>` : ""}</div>
        </a>`).join("") : `<div class="card"><h4>No matches yet</h4><p>When you say yes to an introduction and they say yes too, they'll show up here.</p><div class="row"><a class="btn" href="#/home">See today's introductions</a></div></div>`}`;
  };
  views.matches.after = () => { hydratePhotos(); renderTabs(); if (param("credits") === "1") toast("Thank you! Your pictures will be added in a moment."); };

  views.chat = async () => {
    const mid = +param("m");
    const { data } = await sb.rpc("my_matches");
    const m = (data || []).find(x => x.match_id === mid);
    if (!m || !m.card) return `<div class="msg">This conversation isn't available anymore.</div><div class="row"><a class="btn" href="#/matches">Back to matches</a></div>`;
    const c = m.card;
    return `
      <div class="chathead"><a href="#/matches" class="back" aria-label="Back to matches">‹</a>${avatar(c, 44)}<div><strong>${esc(c.first_name)}, ${c.age}</strong><span class="hint">${esc(c.city)}</span></div>
        <details class="menu"><summary aria-label="More options">•••</summary><div>
          <button type="button" data-unmatch="${mid}" data-name="${esc(c.first_name)}">Unmatch</button>
          <button type="button" data-report="${c.id}" data-name="${esc(c.first_name)}">Report ${esc(c.first_name)}</button>
        </div></details></div>
      <div id="booth" class="booth card" data-m="${mid}" data-name="${esc(c.first_name)}"><strong>Photo booth</strong><span class="hint">Loading…</span></div>
      <div id="msgs" class="msgs" aria-live="polite"><p class="hint">Loading…</p></div>
      <form id="sendf" class="sendf" data-m="${mid}" novalidate>
        <label for="body" class="sr">Message</label>
        <textarea id="body" maxlength="${C.textLimit}" rows="2" placeholder="Write a message"></textarea>
        <div class="sendrow"><span class="count" id="cnt">0/${C.textLimit}</span><button class="btn" type="submit">Send</button></div>
        <p class="err" id="err" role="alert"></p>
      </form>`;
  };
  views.chat.after = async () => {
    hydratePhotos();
    const mid = +param("m"); if (!$("msgs")) return;
    await loadMessages(mid);
    renderBooth();
    stopChat();
    chatChannel = sb.channel("m" + mid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "match_id=eq." + mid }, () => loadMessages(mid))
      .on("postgres_changes", { event: "*", schema: "public", table: "booth_images", filter: "match_id=eq." + mid }, () => loadMessages(mid))
      .subscribe();
    chatPoll = setInterval(() => { if (route() === "chat") loadMessages(mid); }, 15000);
  };
  function stopChat() {
    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
    if (chatPoll) { clearInterval(chatPoll); chatPoll = null; }
  }
  async function loadMessages(mid) {
    const box = $("msgs"); if (!box) return;
    const [msgs, pics] = await Promise.all([
      sb.from("messages").select("id,sender_id,body,created_at").eq("match_id", mid).order("created_at", { ascending: true }).limit(500),
      sb.from("booth_images").select("id,creator_id,path,status,created_at").eq("match_id", mid).order("created_at", { ascending: true }).limit(200)]);
    if (msgs.error) { logErr("messages", msgs.error); box.innerHTML = '<p class="hint">Messages couldn\'t load. Check your connection.</p>'; return; }
    const me = session.user.id, data = msgs.data;
    const items = data.map(x => ({ t: x.created_at, k: "m", x })).concat((pics.data || [])
      .filter(x => x.status !== "failed" || x.creator_id === me).map(x => ({ t: x.created_at, k: "b", x })))
      .sort((a, b) => (a.t < b.t ? -1 : 1));
    const sig = items.map(i => i.k + i.x.id + (i.x.status || "")).join(",");
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = items.length ? items.map(i => {
      const x = i.x;
      if (i.k === "m") return `<div class="bubble${x.sender_id === me ? " mine" : ""}"><p>${esc(x.body)}</p><small>${fmtTime(x.created_at)}</small></div>`;
      const mine = x.creator_id === me ? " mine" : "";
      if (x.status === "done") return `<div class="bubble photo${mine}"><div class="bimg" data-booth="${esc(x.path)}"><span class="hint">Loading picture…</span></div><small>Photo booth · ${fmtTime(x.created_at)}</small></div>`;
      if (x.status === "pending") return `<div class="bubble photo${mine}"><p class="hint">Creating a photo booth picture… this can take up to a minute.</p></div>`;
      return `<div class="bubble photo mine"><p class="hint">That picture couldn't be made. Your free picture or credit wasn't used.</p></div>`;
    }).join("") : '<p class="hint center">You both said yes. Say hello!</p>';
    hydrateBooth(box);
    if (atBottom || items.length < 20) box.scrollTop = box.scrollHeight;
    if (data.some(x => x.sender_id !== me)) sb.rpc("mark_read", { m: mid }).then(() => {}, () => {});
  }

  async function renderBooth() {
    const el = $("booth"); if (!el) return;
    const mid = +el.dataset.m, name = el.dataset.name;
    const [st, cfg, bill] = await Promise.all([sb.rpc("booth_state", { m: mid }), boothCfg(), getBilling()]);
    const s = st.data;
    if (!$("booth")) return;
    if (st.error || !s) { el.hidden = true; return; }
    const packs = bill.configured
      ? `<div class="row tight"><button type="button" class="btn ghost" data-pack="p5">5 pictures · $4.99</button><button type="button" class="btn ghost" data-pack="p12">12 pictures · $9.99</button></div>`
      : '<p class="hint">Extra picture packs are coming soon.</p>';
    let inner;
    if (!s.me_ok) inner = `<span class="hint">${cfg.configured ? "" : "Opening soon. "}Make AI pictures of you and ${name} together: describe a scene and the booth creates it. Both of you need to turn it on.</span>
      <div class="row tight"><button type="button" class="btn ghost" data-boothon>Turn on the photo booth</button></div>`;
    else if (!s.them_ok) inner = `<span class="hint">You've turned it on. Waiting for ${name} to turn it on too.</span>`;
    else if (!cfg.configured) inner = `<span class="hint">You're both set. The photo booth is opening soon; your first picture with ${name} will be free.</span>`;
    else {
      const canMake = s.free_left || s.credits > 0;
      inner = `<span class="hint">${s.free_left ? `Your first picture with ${name} is free.` : s.credits > 0 ? `Uses 1 credit. You have ${s.credits}.` : `You've used your free picture with ${name}. Get more:`}</span>
        ${canMake ? `<label for="scene" class="sr">Describe a scene</label><textarea id="scene" maxlength="${C.textLimit}" rows="2" placeholder="Describe a scene, like: dancing at an outdoor summer concert"></textarea>
        <div class="sendrow"><span class="count" id="scnt">0/${C.textLimit}</span><button type="button" class="btn" data-boothgo="${mid}">Create picture</button></div>` : ""}
        ${canMake && s.credits === 0 ? "" : packs}`;
    }
    el.innerHTML = `<strong>Photo booth</strong>${inner}<p class="err" id="berr" role="alert"></p>`;
  }

  views.admin = async () => {
    if (!isAdmin()) return '<div class="msg">This page is for administrators.</div>';
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [s, mem, rep, ex, fb, er] = await Promise.all([sb.rpc("admin_stats"), sb.rpc("admin_members"), sb.rpc("admin_reports"), sb.rpc("admin_extra"),
      sb.from("feedback").select("id,page,message,contact,created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(50),
      sb.from("client_errors").select("message,page,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(300)]);
    const x = ex.data || {}, errs = {};
    (er.data || []).forEach(e => { const k = e.message; (errs[k] = errs[k] || { n: 0, last: e.created_at, page: e.page }).n++; });
    if (s.error) return `<div class="msg">Couldn't load the numbers. Try again in a minute.</div>`;
    const d = s.data, days = d.visits_by_day || [], top = Math.max(1, ...days.map(x => x.visitors));
    const stat = (n, label) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`;
    return `
      <h2>Admin</h2>
      <p class="sub">Updated when you open this page.</p>
      <h3>Payments and photo booth</h3>
      <div class="card" id="setupstatus"><p class="hint">Checking…</p></div>
      <h3>Visitors</h3>
      <div class="stats">${stat(d.visitors_today, "visitors today")}${stat(d.visitors_7d, "visitors, 7 days")}${stat(d.visits_7d, "page views, 7 days")}</div>
      ${days.length ? `<div class="bars" role="img" aria-label="Visitors per day, last 14 days">${days.map(x => `<div title="${x.day}: ${x.visitors}"><i style="height:${Math.max(4, (x.visitors / top) * 100)}%"></i><small>${new Date(x.day + "T12:00:00").getDate()}</small></div>`).join("")}</div>` : '<p class="hint">No visits recorded yet.</p>'}
      <h3>Members</h3>
      <div class="stats">
        ${stat(d.accounts, "accounts")}${stat(d.accounts_7d, "new this week")}${stat(d.profiles_complete, "complete profiles")}
        ${stat(d.founders + "/100", "founders")}${stat(d.paid, "paid")}${stat(d.questionnaires, "finished 20 questions")}
        ${stat(d.women, "women")}${stat(d.men, "men")}${stat(d.in_pool, "in matching today")}
        ${stat(d.tulsa_area, "Oklahoma")}${stat(d.outside, "outside Oklahoma")}${stat(d.confirmed, "emails confirmed")}
      </div>
      <h3>Activity</h3>
      <div class="stats">${stat(d.intros_today, "introductions today")}${stat(d.matches, "active matches")}${stat(d.messages_7d, "messages, 7 days")}</div>
      <h3>Emails</h3>
      <div class="stats">${stat(x.emails_sent_7d ?? 0, "alerts sent, 7 days")}${stat(x.emails_unsent_7d ?? 0, "couldn't send, 7 days")}</div>
      ${x.emails_unsent_7d ? '<p class="hint">Emails can\'t send until the Resend setup is finished.</p>' : ""}
      <h3>Problems reported ${x.open_feedback ? `<b class="dot">${x.open_feedback}</b>` : ""}</h3>
      ${(fb.data || []).length ? fb.data.map(f => `<div class="card"><p>${esc(f.message)}</p><p class="hint">${fmtDate(f.created_at)} · on ${esc(f.page || "#/")}${f.contact ? ` · reply to ${esc(f.contact)}` : ""}</p><button class="btn ghost" data-fbdone="${f.id}">Mark handled</button></div>`).join("") : '<p class="hint">No open problem reports.</p>'}
      <h3>Site errors, last 7 days</h3>
      ${Object.keys(errs).length ? Object.entries(errs).map(([m, v]) => `<div class="card"><p><strong>${v.n}×</strong> ${esc(m)}</p><p class="hint">Last ${fmtDate(v.last)} · on ${esc(v.page || "#/")}</p></div>`).join("") + '<p class="hint">Tell Claude "check the site errors" and it can look these up and fix them.</p>' : '<p class="hint">No errors recorded.</p>'}
      <h3>Reports ${d.open_reports ? `<b class="dot">${d.open_reports}</b>` : ""}</h3>
      ${(rep.data || []).length ? rep.data.map(r => `<div class="card"><p><strong>${esc(r.reported_name || "Member")}</strong> (${esc(r.reported)})<br><span class="hint">Reported by ${esc(r.reporter)} on ${fmtDate(r.created_at)}</span></p><p>${esc(r.reason)}</p><button class="btn ghost" data-resolve="${r.id}">Mark handled</button></div>`).join("") : '<p class="hint">No open reports.</p>'}
      <h3>Member list</h3>
      ${(mem.data || []).map(u => `<div class="card member">
        <p><strong>${esc(u.first_name || "(no profile yet)")}</strong>${u.founder ? ` · Founder #${u.founder}` : ""}${u.admin ? " · Admin" : ""}<br>
        <span class="hint">${esc(u.email)} · ${esc([u.city, u.state].filter(Boolean).join(", ") || "no town")} · joined ${fmtDate(u.joined)}</span><br>
        <span class="hint">${u.confirmed ? "Email confirmed" : "Email not confirmed"} · ${u.complete ? "Profile complete" : "Profile incomplete"} · ${u.quiz ? "20 questions done" : "Questions not done"}${u.paid_until ? ` · Paid until ${fmtDate(u.paid_until)}` : ""}${u.last_seen ? ` · Last seen ${fmtDate(u.last_seen)}` : ""}</span></p>
        ${u.admin ? "" : `<div class="row tight"><button class="btn ghost" data-paid="${u.id}" data-days="30">Give 30 days free</button>${u.paid_until ? `<button class="btn ghost" data-paid="${u.id}" data-days="0">Remove paid time</button>` : ""}</div>`}
      </div>`).join("")}`;
  };

  views.admin.after = async () => {
    const el = $("setupstatus"); if (!el) return;
    billingCfg = null; boothCfgV = null;
    const [b, bo] = await Promise.all([getBilling(), boothCfg()]);
    el.innerHTML = `
      <p><strong>Payments:</strong> ${!b.configured ? "not switched on yet (waiting for the Stripe key)." : b.connected ? "on and connected to Stripe." : "key added. One more tap to connect Stripe:"}</p>
      ${b.configured && !b.connected ? '<div class="row tight"><button type="button" class="btn" data-connect>Connect Stripe</button></div>' : ""}
      <p><strong>Photo booth:</strong> ${bo.configured ? "on." : "not switched on yet (waiting for the image service key)."}</p>`;
  };

  function authForm(mode) {
    const up = mode === "up";
    return `
      <h2>${up ? "Create your account" : "Welcome back"}</h2>
      <p class="sub">${up ? "Takes about two minutes. Then your profile, photo and 20 questions." : "Sign in to continue."}</p>
      <form id="authf" data-mode="${mode}" novalidate>
        <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <label for="pw">Password ${up ? '<span class="hint">(at least 8 characters)</span>' : ""}</label>
        <input id="pw" type="password" autocomplete="${up ? "new-password" : "current-password"}" required>
        ${up ? `<label class="hint agree"><input id="agree" type="checkbox"> <span>I'm ${C.minAge} or older, I agree to the <a href="terms.html">Terms</a>, <a href="acceptable-use.html">Acceptable Use Policy</a> and <a href="privacy.html">Privacy Policy</a>, and I understand that Second Chapter does not run criminal background checks on members.</span></label>
        <p class="notice">SECOND CHAPTER DOES NOT CONDUCT CRIMINAL BACKGROUND SCREENINGS OF ITS MEMBERS. Please read our <a href="safety.html">safety tips</a> before meeting anyone.</p>` : ""}
        <p class="err" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="submit">${up ? "Create account" : "Sign in"}</button>
          <a class="btn ghost" href="#/${up ? "signin" : "signup"}">${up ? "I already have an account" : "Create an account"}</a></div>
        ${up ? "" : '<p class="hint" style="margin-top:18px"><a href="#/forgot">Forgot your password?</a></p>'}
      </form>`;
  }

  // ---------- render / routing ----------
  const PRIVATE = ["home", "profile", "questions", "membership", "matches", "chat", "admin"], PUBLIC_ONLY = ["signup", "signin", "forgot"];
  async function render() {
    const id = ++renderId;
    let r = route();
    if (recovering) r = "newpass";
    if (!views[r]) r = "";
    if (PRIVATE.includes(r) && !session) { location.hash = "#/signin"; return; }
    if (PUBLIC_ONLY.includes(r) && session) { location.hash = "#/home"; return; }
    if (r === "" && session) { location.hash = "#/home"; return; }
    if (r === "questions" && !profileDone()) { toast("Finish your profile and photo first"); location.hash = "#/profile"; return; }
    if (r === "questions" && !memberActive()) { location.hash = "#/membership"; return; }
    if (r === "membership" && !profileDone()) { location.hash = "#/profile"; return; }
    if (r !== "chat") stopChat();
    logVisit(r); touch();
    renderNav();
    const out = views[r]();
    if (out && typeof out.then === "function") app.innerHTML = '<p class="loading">Loading…</p>';
    const html = await out;
    if (id !== renderId) return; // a newer page was opened meanwhile
    app.innerHTML = html;
    app.focus({ preventScroll: true });
    if (r !== "chat") window.scrollTo(0, 0);
    if (views[r].after) await views[r].after();
  }
  let prevHash = "#/";
  window.addEventListener("hashchange", e => { try { prevHash = new URL(e.oldURL).hash || "#/"; } catch (x) {} render(); });

  // ---------- events ----------
  document.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest('[data-act="out"]')) { await sb.auth.signOut(); return; }

    if (t.closest('[data-act="delete"]')) {
      if (!confirm("Delete your account? Your profile, photo, answers, matches and messages will be permanently removed. This can't be undone.")) return;
      if (profile && profile.photo_path) await sb.storage.from("photos").remove([profile.photo_path]);
      const { error } = await sb.rpc("delete_my_account");
      if (error) { toast("We couldn't delete your account. Please try again."); return; }
      await sb.auth.signOut(); toast("Your account has been deleted");
      return;
    }

    const seg = t.closest(".seg button");
    if (seg) { seg.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === seg))); return; }

    const yes = t.closest("[data-yes]"), pass = t.closest("[data-pass]");
    if (yes || pass) {
      const b = yes || pass, intro = +(yes ? yes.dataset.yes : pass.dataset.pass);
      b.closest(".row").querySelectorAll("button").forEach(x => x.disabled = true);
      const { data, error } = await sb.rpc("respond", { intro, choice: yes ? "interested" : "passed" });
      if (error) { logErr("respond", error); toast("That didn't save. Please try again."); render(); return; }
      if (data && data.matched) { toast("It's a match! Messaging is open."); refreshUnread(); location.hash = "#/chat?m=" + data.match_id; return; }
      toast(yes ? "We'll let you know if it's mutual" : "Passed"); render();
      return;
    }

    const gl = t.closest("[data-glint]");
    if (gl) {
      gl.disabled = true;
      const { data, error } = await sb.rpc("send_glint", { target: gl.dataset.glint });
      const msg = error ? "That didn't send. Please try again." : ({ sent: `Glint sent to ${gl.dataset.name}`, already_sent: "You've already sent a glint", daily_limit: "You can send one glint a day. Try again tomorrow." }[data] || "That didn't send.");
      toast(msg);
      if (data === "sent" || data === "already_sent") gl.outerHTML = `<span class="hint">${HEART} Glint sent</span>`; else gl.disabled = false;
      return;
    }

    const rp = t.closest("[data-report]");
    if (rp) {
      const reason = prompt(`Report ${rp.dataset.name}. What happened? (Up to ${C.textLimit} characters.) This also removes them from your introductions and matches.`);
      if (!reason || !reason.trim()) return;
      const { error } = await sb.rpc("report_user", { target: rp.dataset.report, reason: reason.trim().slice(0, C.textLimit) });
      toast(error ? "The report didn't send. Please try again." : "Thank you. Our team will review it.");
      if (!error) go(route() === "chat" ? "matches" : "home");
      return;
    }

    const um = t.closest("[data-unmatch]");
    if (um) {
      if (!confirm(`Unmatch ${um.dataset.name}? Your conversation will close for both of you and you won't be introduced again.`)) return;
      const { error } = await sb.rpc("unmatch", { m: +um.dataset.unmatch });
      toast(error ? "That didn't work. Please try again." : "Unmatched");
      if (!error) go("matches");
      return;
    }

    const pl = t.closest("[data-plan]");
    if (pl) {
      const err = $("err");
      if (!$("renew").checked) { err.textContent = "Please check the box to confirm you understand how renewal works."; return; }
      busy(pl, true, "Opening checkout…");
      const { data, error } = await fn("billing", { action: "checkout", plan: pl.dataset.plan });
      if (data && data.url) { location.href = data.url; return; }
      busy(pl, false);
      if (error) logErr("checkout", error);
      err.textContent = data && data.error === "already_subscribed" ? "You already have a membership. You can manage it from your Profile page."
        : data && data.configured === false ? "Online payment isn't open yet. Please check back soon."
        : "Checkout didn't open. Please try again in a minute.";
      return;
    }

    const bl = t.closest("[data-bill]");
    if (bl) {
      const act = bl.dataset.bill;
      if (act === "cancel" && !confirm(`Cancel your membership? You'll keep access until ${fmtDate(profile.paid_until)} and won't be charged again.`)) return;
      busy(bl, true);
      const { data, error } = await fn("billing", { action: act });
      if (act === "portal" && data && data.url) { location.href = data.url; return; }
      busy(bl, false);
      if (error || !data || data.error) { logErr("billing " + act, error || data && data.error); toast("That didn't work. Please try again in a minute."); return; }
      await loadMine();
      toast(act === "cancel" ? "Membership canceled. No more charges." : "Your membership will continue.");
      render();
      return;
    }

    const pk = t.closest("[data-pack]");
    if (pk) {
      busy(pk, true, "Opening checkout…");
      const { data, error } = await fn("billing", { action: "credits", pack: pk.dataset.pack });
      if (data && data.url) { location.href = data.url; return; }
      busy(pk, false);
      if (error) logErr("credits checkout", error);
      toast("Checkout didn't open. Please try again in a minute.");
      return;
    }

    if (t.closest("[data-boothon]")) {
      const { error } = await sb.from("profiles").update({ booth_ok: true }).eq("id", session.user.id);
      if (error) { logErr("booth on", error); toast("That didn't save. Please try again."); return; }
      profile.booth_ok = true; toast("Photo booth on"); renderBooth();
      return;
    }

    const bg = t.closest("[data-boothgo]");
    if (bg) {
      const berr = $("berr"), scene = ($("scene").value || "").trim();
      berr.textContent = "";
      if (scene.length < 3) { berr.textContent = "Describe the scene you'd like, in a few words."; return; }
      busy(bg, true, "Starting…");
      const mid = +bg.dataset.boothgo;
      const { data, error } = await sb.rpc("start_booth", { m: mid, scene: scene.slice(0, C.textLimit) });
      if (error || !data || data.error) {
        busy(bg, false);
        if (error) logErr("start booth", error);
        berr.textContent = ({ no_credits: "You're out of pictures for now. Get a pack below.", busy: "You already have a picture being made. Give it a minute.",
          daily_limit: "You've reached today's limit of 20 pictures. Try again tomorrow.", they_not_opted_in: "The other person has turned the photo booth off.",
          you_not_opted_in: "Turn on the photo booth in your Profile first.", too_short: "Describe the scene in a few more words.", not_matched: "This match has ended." }[data && data.error]) || "That didn't start. Please try again.";
        return;
      }
      $("scene").value = "";
      await loadMessages(mid);
      renderBooth();
      const res = await fn("booth", { action: "make", id: data.id });
      if (res.data && res.data.error === "not_configured") toast("The photo booth is opening soon. Nothing was used.");
      else if (res.error || !res.data || !res.data.ok) { logErr("booth make", res.error || res.data && res.data.message); toast("That picture couldn't be made. Nothing was used."); }
      if ($("msgs")) { await loadMessages(mid); renderBooth(); }
      return;
    }

    if (t.closest("[data-connect]")) {
      const b = t.closest("[data-connect]"); busy(b, true, "Connecting…");
      const { data, error } = await fn("billing", { action: "connect" });
      if (error || !data || !data.ok) { busy(b, false); logErr("connect stripe", error || data && data.message); toast("Couldn't connect to Stripe. Check that the key is right."); return; }
      toast(data.livemode ? "Stripe connected" : "Stripe connected in test mode"); render();
      return;
    }

    const fd = t.closest("[data-fbdone]");
    if (fd) {
      fd.disabled = true;
      const { error } = await sb.from("feedback").update({ resolved_at: new Date().toISOString() }).eq("id", +fd.dataset.fbdone);
      toast(error ? "Couldn't update. Try again." : "Marked handled"); render();
      return;
    }

    const rs = t.closest("[data-resolve]");
    if (rs) {
      rs.disabled = true;
      const { error } = await sb.from("reports").update({ resolved_at: new Date().toISOString() }).eq("id", +rs.dataset.resolve);
      toast(error ? "Couldn't update. Try again." : "Marked handled"); render();
      return;
    }

    const pd = t.closest("[data-paid]");
    if (pd) {
      pd.disabled = true;
      const { error } = await sb.rpc("admin_set_paid", { target: pd.dataset.paid, days: +pd.dataset.days });
      toast(error ? "Couldn't update. Try again." : (+pd.dataset.days ? "Added 30 days" : "Paid time removed")); render();
      return;
    }

    const ans = t.closest("[data-ans]");
    if (ans) {
      const [qid, val] = ans.dataset.ans.split(":"), i = +ans.dataset.i;
      ans.parentElement.querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(b === ans)); b.disabled = true; });
      const answers = Object.assign({}, quiz.answers, { [qid]: val });
      const complete = Q.every(q => answers[q.id]);
      const row = { user_id: session.user.id, answers, completed_at: complete ? (quiz.completed_at || new Date().toISOString()) : null };
      const { data, error } = await sb.from("questionnaire").upsert(row).select().single();
      if (error) {
        logErr("save answer", error);
        ans.parentElement.querySelectorAll("button").forEach(b => b.disabled = false);
        $("err").textContent = "We couldn't save that answer. Check your connection and tap it again.";
        return;
      }
      const wasDone = quizDone();
      quiz = data;
      if (complete && !wasDone) { toast("All 20 answered. Here are your introductions."); go("home"); return; }
      if (complete) {
        if (i < Q.length) location.hash = "#/questions?q=" + (i + 1); else { toast("Answers saved"); go("home"); }
        return;
      }
      const next = Q.findIndex((q, k) => k >= i && !answers[q.id]);
      location.hash = "#/questions?q=" + ((next < 0 ? Q.findIndex(q => !answers[q.id]) : next) + 1);
    }
  });

  document.addEventListener("change", async e => {
    const t = e.target;
    if (t.dataset && t.dataset.pref) {
      const field = t.dataset.pref, val = t.checked;
      const { error } = await sb.from("profiles").update({ [field]: val }).eq("id", session.user.id);
      if (error) { t.checked = !val; logErr("email setting", error); toast("That didn't save. Please try again."); return; }
      profile[field] = val; toast(field === "booth_ok" ? (val ? "Photo booth on" : "Photo booth off") : (val ? "Emails on" : "Emails off"));
      return;
    }
    if (t.id === "loc") {
      const other = t.value === "__other";
      $("otherloc").hidden = !other;
      if (other) $("oc").focus();
    }
    if (t.id === "photoin" && t.files && t.files[0]) {
      const file = t.files[0], msg = $("photomsg");
      if (!/^image\//.test(file.type)) { msg.textContent = "Please choose a photo."; return; }
      msg.textContent = "Uploading…";
      try {
        const blob = await resizeImage(file);
        const uid = session.user.id, path = `${uid}/profile-${Date.now()}.jpg`;
        const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw up.error;
        const old = profile && profile.photo_path, wasDone = profileDone();
        const { data, error } = await sb.from("profiles").upsert({ id: uid, photo_path: path }).select().single();
        if (error) throw error;
        if (old && old !== path) sb.storage.from("photos").remove([old]).then(() => {}, () => {});
        profile = data;
        $("myphoto").innerHTML = avatar({ first_name: profile.first_name, photo_path: path, founder: isFounder() }, 120);
        hydratePhotos($("myphoto"));
        msg.textContent = "Photo saved.";
        document.querySelector('label[for="photoin"]').textContent = "Change photo";
        if (!wasDone && profileDone()) afterComplete();
      } catch (err) {
        logErr("photo upload", err);
        msg.textContent = "That photo didn't upload. Try a different one, or check your connection.";
      }
      t.value = "";
    }
  });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "bm" || t.id === "bdd" || t.id === "by") {
      t.value = t.value.replace(/\D/g, "");
      const next = { bm: "bdd", bdd: "by" }[t.id];
      if (next && t.value.length === 2) $(next).focus();
      return;
    }
    if (t.id === "scene") { $("scnt").textContent = t.value.length + "/" + C.textLimit; return; }
    if (t.id === "bio" || t.id === "body" || t.id === "fb") $("cnt").textContent = t.value.length + "/" + C.textLimit;
  });

  function afterComplete() {
    if (isFounder()) { toast(`Welcome, Founding Member #${profile.founder_number}!`); go("membership"); }
    else if (memberActive()) go(quizDone() ? "home" : "questions");
    else go("membership");
  }

  document.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("err"), btn = f.querySelector('button[type="submit"]');
    if (err) err.textContent = "";

    if (f.id === "feedbackf") {
      const msg = $("fb").value.trim(), contact = $("fbc") ? $("fbc").value.trim() : "";
      if (msg.length < 3) { err.textContent = "Tell us a little about what happened."; return; }
      busy(btn, true, "Sending…");
      const { error } = await sb.from("feedback").insert({ message: msg.slice(0, C.textLimit), contact: contact.slice(0, 120) || null, page: prevHash.slice(0, 120) });
      busy(btn, false);
      if (error) { err.textContent = "That didn't send. Please try again, or email support@joinsecondchapter.com."; return; }
      app.innerHTML = `<h2>Thank you</h2><p class="sub">We got your message and will look into it.</p><div class="row"><a class="btn" href="#/${session ? "home" : ""}">Back</a></div>`;
      return;
    }

    if (f.id === "sendf") {
      const box = $("body"), body = box.value.trim(), mid = +f.dataset.m;
      if (!body) return;
      busy(btn, true, "Sending…");
      const { error } = await sb.from("messages").insert({ match_id: mid, sender_id: session.user.id, body: body.slice(0, C.textLimit) });
      busy(btn, false);
      if (error) { logErr("send message", error); err.textContent = "Your message didn't send. This match may have ended, or check your connection."; return; }
      box.value = ""; $("cnt").textContent = "0/" + C.textLimit;
      await loadMessages(mid);
      return;
    }

    if (f.id === "authf") {
      const up = f.dataset.mode === "up", em = $("em").value.trim().toLowerCase(), pw = $("pw").value;
      if (!/^\S+@\S+\.\S+$/.test(em)) { err.textContent = "Enter a valid email address."; return; }
      if (up && pw.length < 8) { err.textContent = "Use a password with at least 8 characters."; return; }
      if (!pw) { err.textContent = "Enter your password."; return; }
      if (up && !$("agree").checked) { err.textContent = "Please confirm you're " + C.minAge + " or older and agree to the policies."; return; }
      busy(btn, true);
      const res = up
        ? await sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: location.origin + location.pathname } })
        : await sb.auth.signInWithPassword({ email: em, password: pw });
      busy(btn, false);
      if (res.error) { err.textContent = friendly(res.error); return; }
      if (up && !res.data.session) {
        app.innerHTML = `<h2>Check your email</h2><p class="sub">We sent a confirmation link to <strong>${esc(em)}</strong>. Tap it, then come back and sign in. If you don't see it in a few minutes, check your spam folder.</p><div class="row"><a class="btn" href="#/signin">Go to sign in</a></div>`;
      }
      return;
    }

    if (f.id === "forgotf") {
      const em = $("em").value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(em)) { err.textContent = "Enter a valid email address."; return; }
      busy(btn, true);
      const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      busy(btn, false);
      if (error) { err.textContent = friendly(error); return; }
      app.innerHTML = `<h2>Check your email</h2><p class="sub">If an account exists for <strong>${esc(em)}</strong>, a reset link is on its way.</p>`;
      return;
    }

    if (f.id === "newpassf") {
      const pw = $("pw").value;
      if (pw.length < 8) { err.textContent = "Use a password with at least 8 characters."; return; }
      busy(btn, true);
      const { error } = await sb.auth.updateUser({ password: pw });
      busy(btn, false);
      if (error) { err.textContent = friendly(error); return; }
      recovering = false; toast("Password updated"); go("home");
      return;
    }

    if (f.id === "proff") {
      const pick = name => { const b = f.querySelector(`[data-field="${name}"] [aria-pressed="true"]`); return b ? b.dataset.val : null; };
      const bm = +$("bm").value, bdd = +$("bdd").value, by = +$("by").value;
      const real = new Date(by, bm - 1, bdd);
      const validDate = by >= 1900 && bm >= 1 && bm <= 12 && bdd >= 1 && real.getMonth() === bm - 1 && real.getDate() === bdd;
      const birthdate = validDate ? `${by}-${String(bm).padStart(2, "0")}-${String(bdd).padStart(2, "0")}` : "";
      const first_name = $("nm").value.trim(), gender = pick("gender"), seeking = pick("seeking");
      const loc = $("loc").value, bio = $("bio").value.trim();
      const city = loc === "__other" ? $("oc").value.trim() : loc, state = loc === "__other" ? $("os").value.trim() : "OK";
      const age = ageFrom(birthdate);
      if (!first_name) { err.textContent = "Enter your first name."; return; }
      if (!birthdate || age === null || age > 110) { err.textContent = "Enter your full date of birth, for example 5 / 14 / 1968."; return; }
      if (age < C.minAge) { err.textContent = "Second Chapter is for people " + C.minAge + " and over."; return; }
      if (!gender) { err.textContent = "Choose whether you're a man or a woman."; return; }
      if (!seeking) { err.textContent = "Choose who you're interested in."; return; }
      if (!city || !state) { err.textContent = loc === "__other" ? "Enter your city and state." : "Choose your town."; return; }
      if (bio.length < 20) { err.textContent = "Write at least a sentence or two for your bio."; return; }
      busy(btn, true, "Saving…");
      const wasDone = profileDone();
      const { data, error } = await sb.from("profiles").upsert({ id: session.user.id, first_name, birthdate, gender, seeking, city, state, bio }).select().single();
      busy(btn, false);
      if (error) { logErr("save profile", error); err.textContent = "We couldn't save your profile. Please try again."; return; }
      profile = data;
      if (!profile.photo_path) { toast("Saved. Now add your photo."); $("photomsg").textContent = "Add a photo to finish your profile."; $("photomsg").classList.add("err"); document.querySelector(".photo-edit").scrollIntoView({ behavior: "smooth" }); return; }
      toast("Profile saved");
      if (!wasDone && profileDone()) afterComplete(); else go("home");
    }
  });

  // ---------- start ----------
  sb.auth.onAuthStateChange((event, s) => {
    const changed = (s && s.user.id) !== (session && session.user.id);
    session = s;
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (event === "SIGNED_OUT") { profile = null; quiz = null; recovering = false; unread = 0; stopChat(); location.hash = "#/"; render(); return; }
    if (changed) setTimeout(async () => { await loadMine(); render(); refreshUnread(); }, 0);
  });
  (async () => {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await loadMine();
    render();
    refreshUnread();
    setInterval(() => { if (route() !== "chat" && document.visibilityState === "visible") refreshUnread(); }, 60000);
  })();
})();
