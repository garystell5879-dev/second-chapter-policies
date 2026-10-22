(function () {
  "use strict";
  const C = window.SC_CONFIG, Q = window.SC_QUESTIONS, LOC = window.SC_LOCATIONS;
  const app = document.getElementById("app"), nav = document.getElementById("nav");

  if (!window.supabase) {
    app.innerHTML = '<div class="msg">We couldn\'t load the sign-in service. Check your connection and refresh the page.</div>';
    return;
  }
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey);

  let session = null, profile = null, quiz = null, recovering = false;

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);
  const route = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "");
  const go = r => { if (route() === r) render(); else location.hash = "#/" + r; };
  function toast(t) {
    const e = document.createElement("div"); e.className = "toast"; e.setAttribute("role", "status"); e.textContent = t;
    document.body.appendChild(e); setTimeout(() => e.remove(), 2400);
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
  const answered = () => quiz ? Q.filter(q => quiz.answers && quiz.answers[q.id]).length : 0;
  const profileDone = () => !!(profile && profile.first_name && profile.birthdate && profile.gender && profile.seeking && profile.city && profile.state && profile.bio);
  const quizDone = () => !!(quiz && quiz.completed_at);
  const friendly = e => {
    const m = (e && e.message) || "";
    if (/invalid login/i.test(m)) return "Email or password is incorrect. Check both and try again.";
    if (/already registered/i.test(m)) return "That email already has an account. Sign in instead.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for the link we sent.";
    if (/rate limit/i.test(m)) return "Too many attempts in a short time. Wait a few minutes and try again.";
    if (/password/i.test(m)) return m;
    return "Something went wrong on our end. Please try again." + (m ? " (" + m + ")" : "");
  };

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

  // ---------- nav ----------
  function renderNav() {
    nav.innerHTML = session
      ? '<a href="#/home">My page</a><a href="#/profile">Profile</a><button type="button" data-act="out">Sign out</button>'
      : '<a href="#/signin">Sign in</a>';
  }

  // ---------- views ----------
  const views = {
    "": () => `
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
      <div class="founder"><strong>Founding members:</strong> the first 100 people to complete a profile get their first two months free.</div>
      <div class="row"><a class="btn" href="#/signup">Create your profile</a><a class="btn ghost" href="#/signin">Sign in</a></div>
      <h3>Membership</h3>
      <div class="price"><div><strong>$9.99</strong>per week</div><div><strong>$36</strong>per month</div></div>
      <p class="hint">Cancel anytime. See <a href="pricing.html">pricing</a> and <a href="refunds.html">refunds</a>.</p>`,

    signup: () => authForm("up"),
    signin: () => authForm("in"),

    forgot: () => `
      <h2>Reset your password</h2>
      <p class="sub">We'll email you a link to choose a new one.</p>
      <form id="forgotf" novalidate>
        <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <p class="err" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="submit">Send reset link</button><a class="btn ghost" href="#/signin">Back to sign in</a></div>
      </form>`,

    newpass: () => `
      <h2>Choose a new password</h2>
      <form id="newpassf" novalidate>
        <label for="pw">New password <span class="hint">(at least 8 characters)</span></label>
        <input id="pw" type="password" autocomplete="new-password" required>
        <p class="err" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="submit">Save password</button></div>
      </form>`,

    profile: () => {
      const p = profile || {}, other = p.city && !LOC.includes(p.city);
      const sel = (v, x) => v === x ? ' aria-pressed="true"' : ' aria-pressed="false"';
      return `
      <h2>${profileDone() ? "Your profile" : "Tell us about you"}</h2>
      <p class="sub">Only your first name, age, town and bio are shown to your matches.</p>
      <form id="proff" novalidate>
        <label for="nm">First name</label>
        <input id="nm" value="${esc(p.first_name)}" autocomplete="given-name" maxlength="30">
        <label for="bd">Date of birth <span class="hint">(members must be ${C.minAge} or older)</span></label>
        <input id="bd" type="date" value="${esc(p.birthdate)}" autocomplete="bday">
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
          <div class="price" style="margin:0">
            <div style="padding:0;border:0;background:none"><label for="oc" style="margin-top:0">City</label><input id="oc" maxlength="80" value="${other ? esc(p.city) : ""}" autocomplete="address-level2"></div>
            <div style="padding:0;border:0;background:none"><label for="os" style="margin-top:0">State</label><input id="os" maxlength="40" value="${other ? esc(p.state) : ""}" autocomplete="address-level1"></div>
          </div>
        </div>
        <label for="bio">A short bio</label>
        <textarea id="bio" maxlength="${C.textLimit}" placeholder="A few lines about you and what a good day looks like.">${esc(p.bio)}</textarea>
        <div class="count" id="cnt">${(p.bio || "").length}/${C.textLimit}</div>
        <p class="err" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="submit">${profileDone() ? "Save changes" : "Save and continue"}</button></div>
      </form>`;
    },

    questions: () => {
      const a = (quiz && quiz.answers) || {};
      let i = +(new URLSearchParams(location.hash.split("?")[1] || "").get("q") || 0);
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
    },

    home: () => {
      const n = answered(), pd = profileDone(), qd = quizDone();
      const away = profile && profile.state && !/^(ok|oklahoma)$/i.test(profile.state.trim());
      return `
      <h2>Hello${profile && profile.first_name ? ", " + esc(profile.first_name) : ""}</h2>
      <p class="sub">${pd && qd ? "You're all set." : "Two steps and you're ready for introductions."}</p>
      <div class="card check"><div><strong>Your profile</strong></div>
        ${pd ? '<span class="st done">Done ✓</span>' : '<a class="btn" href="#/profile">Start</a>'}</div>
      <div class="card check"><div><strong>The 20 questions</strong><div class="st">${n} of ${Q.length} answered</div></div>
        ${qd ? '<span class="st done">Done ✓</span>' : `<a class="btn${pd ? "" : " ghost"}" href="#/questions">${n ? "Continue" : "Start"}</a>`}</div>
      ${pd && qd ? `<div class="msg"><strong>What happens next:</strong> your first five introductions arrive when matching opens${away ? ". We're starting in the Tulsa area, so we'll introduce you as members join near you" : " in the Tulsa area"}. We'll email you at ${esc(session.user.email)}.</div>
        <p class="hint">You can change your answers anytime: <a href="#/questions?q=1">review the 20 questions</a>.</p>` : ""}`;
    }
  };

  function authForm(mode) {
    const up = mode === "up";
    return `
      <h2>${up ? "Create your account" : "Welcome back"}</h2>
      <p class="sub">${up ? "Takes about two minutes. Then your profile and 20 questions." : "Sign in to continue."}</p>
      <form id="authf" data-mode="${mode}" novalidate>
        <label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
        <label for="pw">Password ${up ? '<span class="hint">(at least 8 characters)</span>' : ""}</label>
        <input id="pw" type="password" autocomplete="${up ? "new-password" : "current-password"}" required>
        ${up ? `<label class="hint" style="display:flex;gap:10px;align-items:flex-start;font-weight:400"><input id="agree" type="checkbox" style="width:auto;margin-top:5px"> <span>I'm ${C.minAge} or older and agree to the <a href="terms.html">Terms</a>, <a href="acceptable-use.html">Acceptable Use Policy</a> and <a href="privacy.html">Privacy Policy</a>.</span></label>` : ""}
        <p class="err" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="submit">${up ? "Create account" : "Sign in"}</button>
          <a class="btn ghost" href="#/${up ? "signin" : "signup"}">${up ? "I already have an account" : "Create an account"}</a></div>
        ${up ? "" : '<p class="hint" style="margin-top:18px"><a href="#/forgot">Forgot your password?</a></p>'}
      </form>`;
  }

  // ---------- render / routing ----------
  const PRIVATE = ["home", "profile", "questions"], PUBLIC_ONLY = ["signup", "signin", "forgot"];
  function render() {
    let r = route();
    if (recovering) r = "newpass";
    if (!views[r]) r = "";
    if (PRIVATE.includes(r) && !session) { location.hash = "#/signin"; return; }
    if (PUBLIC_ONLY.includes(r) && session) { location.hash = "#/home"; return; }
    if (r === "" && session) { location.hash = "#/home"; return; }
    if (r === "questions" && !profileDone()) { toast("Finish your profile first"); location.hash = "#/profile"; return; }
    renderNav();
    app.innerHTML = views[r]();
    app.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);

  // ---------- events ----------
  document.addEventListener("click", async e => {
    const out = e.target.closest('[data-act="out"]');
    if (out) { await sb.auth.signOut(); return; }

    const seg = e.target.closest(".seg button");
    if (seg) { seg.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === seg))); return; }

    const ans = e.target.closest("[data-ans]");
    if (ans) {
      const [qid, val] = ans.dataset.ans.split(":"), i = +ans.dataset.i;
      ans.parentElement.querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(b === ans)); b.disabled = true; });
      const answers = Object.assign({}, quiz.answers, { [qid]: val });
      const complete = Q.every(q => answers[q.id]);
      const row = { user_id: session.user.id, answers, completed_at: complete ? (quiz.completed_at || new Date().toISOString()) : null };
      const { data, error } = await sb.from("questionnaire").upsert(row).select().single();
      if (error) {
        ans.parentElement.querySelectorAll("button").forEach(b => b.disabled = false);
        $("err").textContent = "We couldn't save that answer. Check your connection and tap it again.";
        return;
      }
      const wasDone = quizDone();
      quiz = data;
      if (complete && !wasDone) { toast("All 20 answered"); go("home"); return; }
      if (complete) { // reviewing answers: step through, then back home
        if (i < Q.length) location.hash = "#/questions?q=" + (i + 1); else { toast("Answers saved"); go("home"); }
        return;
      }
      const next = Q.findIndex((q, k) => k >= i && !answers[q.id]);
      location.hash = "#/questions?q=" + ((next < 0 ? Q.findIndex(q => !answers[q.id]) : next) + 1);
    }
  });

  document.addEventListener("change", e => {
    if (e.target.id === "loc") {
      const other = e.target.value === "__other";
      $("otherloc").hidden = !other;
      if (other) $("oc").focus();
    }
  });
  document.addEventListener("input", e => {
    if (e.target.id === "bio") $("cnt").textContent = e.target.value.length + "/" + C.textLimit;
  });

  document.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, err = $("err"), btn = f.querySelector('button[type="submit"]');
    err.textContent = "";

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
        app.innerHTML = `<h2>Check your email</h2><p class="sub">We sent a confirmation link to <strong>${esc(em)}</strong>. Tap it, then come back and sign in.</p><div class="row"><a class="btn" href="#/signin">Go to sign in</a></div>`;
      }
      return; // onAuthStateChange takes it from here
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
      const first_name = $("nm").value.trim(), birthdate = $("bd").value, gender = pick("gender"), seeking = pick("seeking");
      const loc = $("loc").value, bio = $("bio").value.trim();
      const city = loc === "__other" ? $("oc").value.trim() : loc, state = loc === "__other" ? $("os").value.trim() : "OK";
      const age = ageFrom(birthdate);
      if (!first_name) { err.textContent = "Enter your first name."; return; }
      if (!birthdate || age === null || age > 110) { err.textContent = "Enter your date of birth."; return; }
      if (age < C.minAge) { err.textContent = "Second Chapter is for people " + C.minAge + " and over."; return; }
      if (!gender) { err.textContent = "Choose whether you're a man or a woman."; return; }
      if (!seeking) { err.textContent = "Choose who you're interested in."; return; }
      if (!city || !state) { err.textContent = loc === "__other" ? "Enter your city and state." : "Choose your town."; return; }
      if (bio.length < 20) { err.textContent = "Write at least a sentence or two for your bio."; return; }
      busy(btn, true, "Saving…");
      const { data, error } = await sb.from("profiles").upsert({ id: session.user.id, first_name, birthdate, gender, seeking, city, state, bio }).select().single();
      busy(btn, false);
      if (error) { err.textContent = "We couldn't save your profile. Please try again."; return; }
      const firstTime = !profileDone();
      profile = data; toast("Profile saved");
      go(firstTime && !quizDone() ? "questions" : "home");
    }
  });

  // ---------- start ----------
  sb.auth.onAuthStateChange((event, s) => {
    const changed = (s && s.user.id) !== (session && session.user.id);
    session = s;
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (event === "SIGNED_OUT") { profile = null; quiz = null; recovering = false; location.hash = "#/"; renderNav(); render(); return; }
    if (changed) setTimeout(async () => { await loadMine(); render(); }, 0);
  });
  (async () => {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await loadMine();
    render();
  })();
})();
