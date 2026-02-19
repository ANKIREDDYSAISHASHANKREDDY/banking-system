/* app.js - frontend SPA for demo bank
   Requires backend routes from updated BankApp.java
*/

const API = "/api";
const app = document.getElementById("app");
const pageTitle = document.getElementById("pageTitle");
const userSummary = document.getElementById("userSummary");

// helper
function el(id){return document.getElementById(id);}
function showMsg(el, msg, ok=true, t=3000){ if(!el) return; el.textContent=msg; el.style.color = ok? 'green':'crimson'; if(t>0) setTimeout(()=>el.textContent='', t); }

// ---- LOGIN (login.html) ----
if (document.getElementById("loginForm")) {
  const roleSelect = document.getElementById("role");
  const accLabel = document.getElementById("accLabel");
  roleSelect.addEventListener("change", () => {
    accLabel.style.display = roleSelect.value === "admin" ? "none" : "block";
    document.getElementById("accNo").style.display = roleSelect.value === "admin" ? "none" : "block";
  });

  document.getElementById("openCreate").addEventListener("click", ()=>{
    window.location.href = "index.html";
    sessionStorage.setItem("openCreate", "1");
  });

  document.getElementById("loginForm").addEventListener("submit", async (e)=> {
    e.preventDefault();
    const role = roleSelect.value;
    const accNo = parseInt(document.getElementById("accNo").value || 0);
    const password = document.getElementById("password").value;
    const payload = role === "admin" ? { role, password } : { role, accNo, password };
    const r = await fetch(`${API}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (j.status === 'ok') {
      if (role === 'admin') localStorage.setItem('user', JSON.stringify({ role: 'admin' }));
      else localStorage.setItem('user', JSON.stringify({ role: 'customer', accNo: j.account.accNo }));
      window.location.href = "index.html";
    } else {
      showMsg(document.getElementById('loginMessage'), j.message || 'Login failed', false);
    }
  });
}

// ---- INDEX / SPA ----
if (document.getElementById("app")) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) window.location.href = 'login.html';
  userSummary.textContent = user.role === 'admin' ? 'Admin' : `Acc#: ${user.accNo}`;
  document.querySelectorAll('.side-item').forEach(b=> b.addEventListener('click', ()=> renderRoute(b.dataset.route, user)));
  el('logoutBtn').addEventListener('click', async ()=> { await fetch(`${API}/logout`); localStorage.removeItem('user'); window.location.href='login.html'; });
  document.getElementById('menuToggle')?.addEventListener('click', ()=> document.getElementById('sidebar')?.classList.toggle('collapsed'));
  // default
  renderRoute('accounts', user);
  if (sessionStorage.getItem('openCreate')) { renderRoute('accounts', user, { openCreate: true }); sessionStorage.removeItem('openCreate'); }
}

// Router
async function renderRoute(route, user, opts={}) {
  pageTitle.textContent = ({ accounts: 'Accounts', payments:'Payments', cards:'Cards', support:'Support' }[route] || 'Dashboard');
  if (route === 'accounts') {
    if (user.role === 'admin') await renderAdmin();
    else await renderCustomer(user.accNo);
  } else if (route === 'payments') {
    await renderPayments(user);
  } else if (route === 'cards') {
    await renderCards(user);
  } else if (route === 'support') {
    renderSupport();
  } else {
    app.innerHTML = `<div class="card"><h3>Welcome</h3></div>`;
  }
}

/* ---------------- ADMIN ---------------- */
async function renderAdmin() {
  app.innerHTML = `
    <div class="admin-dashboard">
      <div class="card admin-panel">
        <h3>Create Customer Account</h3>
        <div class="form-row"><label>Name</label><input id="adm_name" placeholder="Full name"></div>
        <div class="form-row"><label>Initial Balance</label><input id="adm_balance" type="number" placeholder="0"></div>
        <div class="form-row"><label>Password (optional)</label><input id="adm_password" placeholder="leave blank => pass123"></div>
        <div style="display:flex;gap:8px"><button id="adm_create" class="btn primary">Create</button><button id="adm_refresh" class="btn ghost">Refresh</button></div>
        <p id="adm_msg" class="small muted"></p>
      </div>

      <div class="card accounts-list">
        <h3>All Accounts</h3>
        <table class="table" id="accountsTable"><thead><tr><th>Acc No</th><th>Name</th><th>Balance</th><th>Actions</th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  `;
  const load = async ()=> {
    const r = await fetch(`${API}/accounts`);
    const list = await r.json();
    const tbody = document.querySelector('#accountsTable tbody');
    tbody.innerHTML = list.map(a => `<tr>
      <td>${a.accNo}</td><td>${a.name}</td><td>₹${Number(a.balance).toFixed(2)}</td>
      <td><button class="btn ghost small" data-action="view" data-id="${a.accNo}">View</button>
          <button class="btn ghost small danger" data-action="delete" data-id="${a.accNo}">Delete</button></td>
    </tr>`).join('');
  };

  document.getElementById('adm_create').addEventListener('click', async ()=> {
    const name = el('adm_name').value.trim();
    const balance = parseFloat(el('adm_balance').value || 0);
    const password = el('adm_password').value.trim();
    const msg = el('adm_msg');
    if (!name) return showMsg(msg, 'Enter name', false);
    const payload = password ? { name, balance, password } : { name, balance };
    const r = await fetch(`${API}/accounts`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (j.status === 'ok') { showMsg(msg, 'Created acc: ' + j.account.accNo, true); await load(); }
    else showMsg(msg, j.message || 'Error', false);
  });

  document.getElementById('adm_refresh').addEventListener('click', load);

  document.querySelector('.accounts-list').addEventListener('click', async (e)=> {
    const btn = e.target.closest('button'); if(!btn) return;
    const id = btn.dataset.id, action = btn.dataset.action;
    if (action === 'view') await showAccountModal(id);
    else if (action === 'delete') {
      if (!confirm('Delete account '+id+'?')) return;
      const r = await fetch(`${API}/accounts/${id}`, { method:'DELETE' });
      const j = await r.json().catch(()=>null);
      if (r.ok || (j && j.status==='ok')) await load();
      else alert('Delete failed');
    }
  });

  await load();
}

/* admin modal */
async function showAccountModal(id) {
  const r = await fetch(`${API}/accounts/${id}`);
  if (!r.ok) return alert('Failed');
  const acc = await r.json();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div style="width:620px;background:#fff;padding:18px;border-radius:12px;box-shadow:0 8px 32px rgba(2,6,23,0.12)">
    <h3>Account ${acc.accNo} — ${acc.name}</h3>
    <p>Balance: ₹${acc.balance.toFixed(2)}</p>
    <h4>Transactions</h4>
    <div style="max-height:300px;overflow:auto;border:1px solid #eef2f7;padding:8px;border-radius:8px">
      ${(acc.transactions||[]).slice().reverse().map(t=>`<div style="padding:8px;border-bottom:1px dashed #f3f6f9"><strong>${t.type}</strong> ₹${t.amount} • ${t.date}<div class="small muted">${t.note||''}</div></div>`).join('') || '<div class="small muted">No transactions</div>'}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button id="closeModal" class="btn ghost">Close</button></div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('closeModal').onclick = ()=> overlay.remove();
}

/* ---------------- CUSTOMER ---------------- */
async function renderCustomer(accNo) {
  const res = await fetch(`${API}/accounts/${accNo}`);
  if (!res.ok) { app.innerHTML = `<div class="card">Account not found</div>`; return; }
  const acc = await res.json();

  app.innerHTML = `
    <div class="row">
      <div class="card balance-card">
        <div class="small">Welcome back</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:700">${acc.name}</div>
            <div class="small">Acc # ${acc.accNo}</div>
          </div>
          <div style="text-align:right"><div class="small">Available Balance</div><div class="balance" id="balVal">₹${acc.balance.toFixed(2)}</div></div>
        </div>
        <div class="actions" style="margin-top:12px">
          <button id="depBtn" class="btn primary">Deposit</button>
          <button id="pwdBtn" class="btn ghost">Change Password</button>
          <button id="csvBtn" class="btn ghost">Download Statement</button>
        </div>
      </div>

      <div class="card">
        <canvas id="balanceChart" height="150"></canvas>
      </div>
    </div>

    <div class="card transfer-card" style="margin-top:16px">
      <h3>Transfer Funds</h3>
      <form id="transferForm" class="form">
        <div class="form-row"><label>Receiver Account No</label><input type="number" id="targetAcc" placeholder="Beneficiary account number" required></div>
        <div class="form-row"><label>Amount</label><input type="number" id="transferAmt" placeholder="Amount" required></div>
        <div class="form-row"><label>Note (optional)</label><input type="text" id="transferNote" placeholder="Payment note"></div>
        <button type="submit" class="btn primary" style="margin-top:10px;width:180px">Submit Transfer</button>
        <p id="transferMsg" class="small muted" style="margin-top:8px"></p>
      </form>
    </div>

    <div class="card transactions" style="margin-top:16px">
      <h3>Transaction History</h3>
      <table class="table" id="txnTable"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance</th><th>Note</th></tr></thead><tbody>${(acc.transactions||[]).slice().reverse().map(t=>`<tr><td>${t.date}</td><td>${t.type}</td><td>₹${t.amount}</td><td>₹${t.balanceAfter}</td><td>${t.note||''}</td></tr>`).join('')}</tbody></table>
    </div>
  `;

  // chart
  const tx = acc.transactions || [];
  const labels = tx.map(t => t.date);
  const data = tx.map(t => t.balanceAfter);
  const ctx = document.getElementById('balanceChart').getContext('2d');
  new Chart(ctx, { type:'line', data:{ labels, datasets:[{ label:'Balance', data, borderColor:'#0073e6', backgroundColor:'rgba(0,115,230,0.08)', fill:true }] }, options:{ maintainAspectRatio:true } });

  // events
  el('depBtn').onclick = async () => {
    const amt = parseFloat(prompt('Deposit amount'));
    if (!amt || amt <= 0) return;
    await fetch(`${API}/accounts/${accNo}/deposit`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount: amt }) });
    renderCustomer(accNo);
  };

  el('pwdBtn').onclick = async () => {
    const cur = prompt('Current password');
    const nw = prompt('New password');
    if (!cur || !nw) return;
    const r = await fetch(`${API}/accounts/${accNo}/change-password`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ current: cur, new: nw }) });
    const j = await r.json();
    if (j.status === 'ok') alert('Password changed');
    else alert(j.message || 'Error');
  };

  el('csvBtn').onclick = async () => {
    const r = await fetch(`${API}/accounts/${accNo}/statement`);
    const text = await r.text();
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `statement_${accNo}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // transfer form
  document.getElementById('transferForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const target = parseInt(el('targetAcc').value);
    const amt = parseFloat(el('transferAmt').value);
    const note = el('transferNote').value.trim();
    const msg = el('transferMsg');
    if (!target || !amt || amt <= 0) { showMsg(msg, 'Please fill valid details', false); return; }
    const res = await fetch(`${API}/accounts/${accNo}/transfer`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ target, amount: amt, note }) });
    const data = await res.json();
    if (data.status === 'ok') { showMsg(msg, 'Transfer successful', true); renderCustomer(accNo); }
    else showMsg(msg, data.message || 'Transfer failed', false);
  });

  gsap.from(".card", { y:10, opacity:0, duration:0.5, stagger:0.06 });
}

/* ---------------- PAYMENTS (with UPI) ---------------- */
/* ---------------- PAYMENTS (UPI + QR) ---------------- */
async function renderPayments(user) {
  pageTitle.textContent = 'Payments';
  app.innerHTML = `
    <div class="row">
      <div class="card" id="upiCard">
        <h3>UPI Payments</h3>
        <div class="tab-buttons" style="display:flex;gap:8px;margin-bottom:12px">
          <button id="tabStatic" class="btn primary">Static QR</button>
          <button id="tabDynamic" class="btn ghost">Dynamic Pay</button>
        </div>

        <!-- Static QR -->
        <div id="staticForm">
          <form id="staticQRForm">
            <div class="form-row"><label>Merchant UPI ID</label><input id="stat_upiId" placeholder="merchant@bank" required></div>
            <div class="form-row"><label>Amount (optional)</label><input id="stat_amt" type="number" placeholder="Enter fixed amount"></div>
            <div class="form-row"><label>Note (optional)</label><input id="stat_note" placeholder="Payment note"></div>
            <button class="btn primary" id="genStatic">Generate QR</button>
            <button type="button" class="btn ghost" id="downloadStatic">Download QR</button>
            <p id="stat_msg" class="small muted"></p>
          </form>
        </div>

        <!-- Dynamic QR -->
        <div id="dynamicForm" style="display:none">
          <form id="upiForm">
            <div class="form-row"><label>Receiver UPI ID</label><input id="upiId" placeholder="receiver@bank" required></div>
            <div class="form-row"><label>Amount</label><input id="upiAmt" type="number" placeholder="Amount" required></div>
            <div class="form-row"><label>Note (optional)</label><input id="upiNote" placeholder="Payment note"></div>
            <button id="upiSubmit" class="btn primary">Pay Now</button>
            <button type="button" class="btn ghost" id="downloadDyn">Download QR</button>
            <p id="upiMsg" class="small muted"></p>
          </form>
        </div>

        <div id="qrcode" style="margin-top:16px;display:flex;justify-content:center"></div>
      </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  `;

  // --- Tab switcher ---
  const tabStatic = el('tabStatic');
  const tabDynamic = el('tabDynamic');
  tabStatic.onclick = () => {
    el('staticForm').style.display = 'block';
    el('dynamicForm').style.display = 'none';
    tabStatic.className = 'btn primary';
    tabDynamic.className = 'btn ghost';
    el('qrcode').innerHTML = '';
  };
  tabDynamic.onclick = () => {
    el('staticForm').style.display = 'none';
    el('dynamicForm').style.display = 'block';
    tabStatic.className = 'btn ghost';
    tabDynamic.className = 'btn primary';
    el('qrcode').innerHTML = '';
  };

  // --- QR Helper ---
  function makeUPIURI(pa, am, tn) {
    let params = new URLSearchParams({ pa, cu: 'INR' });
    if (am) params.append('am', am);
    if (tn) params.append('tn', tn);
    return `upi://pay?${params.toString()}`;
  }

  function renderQR(text) {
    const container = el('qrcode');
    container.innerHTML = '';
    new QRCode(container, { text, width: 200, height: 200 });
  }

  // --- Static QR ---
  el('genStatic').addEventListener('click', (e)=>{
    e.preventDefault();
    const upiId = el('stat_upiId').value.trim();
    const amt = el('stat_amt').value.trim();
    const note = el('stat_note').value.trim();
    const msg = el('stat_msg');
    if (!upiId) return showMsg(msg, 'Enter UPI ID', false);
    const uri = makeUPIURI(upiId, amt, note);
    renderQR(uri);
    showMsg(msg, 'Static QR generated', true);
  });

  el('downloadStatic').addEventListener('click', ()=>{
    const img = document.querySelector('#qrcode img');
    if (!img) return alert('Generate QR first');
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'upi_static.png';
    a.click();
  });

  // --- Dynamic Pay ---
  el('upiForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = JSON.parse(localStorage.getItem('user')||'{}');
    const accNo = u.accNo;
    const upiId = el('upiId').value.trim();
    const amt = parseFloat(el('upiAmt').value);
    const note = el('upiNote').value.trim();
    const msg = el('upiMsg');
    if (!upiId || !amt || amt<=0) return showMsg(msg,'Invalid details',false);

    // create QR first
    const uri = makeUPIURI(upiId, amt, note);
    renderQR(uri);

    // call backend to simulate debit
    const res = await fetch(`${API}/accounts/${accNo}/upi`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ upiId, amount: amt, note })
    });
    const j = await res.json();
    if (j.status === 'ok') showMsg(msg, '✅ Payment successful', true);
    else showMsg(msg, j.message || 'UPI payment failed', false);
  });

  el('downloadDyn').addEventListener('click', ()=>{
    const img = document.querySelector('#qrcode img');
    if (!img) return alert('Generate QR first');
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'upi_dynamic.png';
    a.click();
  });

  gsap.from("#upiCard", { opacity:0, y:20, duration:0.6 });
}


/* ---------------- CARDS ---------------- */
async function renderCards(user) {
  pageTitle.textContent = 'Cards';
  app.innerHTML = `<div class="row"><div class="card"><h3>Your Cards</h3><div id="cardsList" style="display:flex;gap:12px;flex-wrap:wrap"></div><div style="margin-top:12px"><label>Card Type</label><select id="cardType"><option>DEBIT</option><option>CREDIT</option></select><button id="reqCard" class="btn primary" style="margin-left:8px">Request New Card</button><p id="cardMsg" class="small muted"></p></div></div></div>`;
  const userAcc = user;
  if (!userAcc || userAcc.role !== 'customer') { document.getElementById('cardsList').innerHTML = '<div class="small muted">Cards shown for logged-in customer only.</div>'; return; }
  const accNo = userAcc.accNo;
  const listEl = document.getElementById('cardsList');
  const res = await fetch(`${API}/accounts/${accNo}/cards`);
  const cards = await res.json();
  listEl.innerHTML = cards.length ? cards.map(c => `
    <div class="card-visual card" style="min-width:260px">
      <div style="display:flex;justify-content:space-between;align-items:center"><div>${c.type}</div><div style="font-size:12px">${c.expiry}</div></div>
      <div style="margin-top:10px"><div class="num">${c.masked}</div></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:12px"><div>VALID THRU</div><div>CVV: ***</div></div>
    </div>
  `).join('') : '<div class="small muted">No cards found.</div>';

  document.getElementById('reqCard').onclick = async () => {
    const type = document.getElementById('cardType').value;
    const msg = document.getElementById('cardMsg');
    const r = await fetch(`${API}/accounts/${accNo}/cards`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
    const j = await r.json();
    if (j.status === 'ok') { showMsg(msg, 'Card requested: ' + j.card.masked, true); renderCards(user); }
    else showMsg(msg, j.message || 'Request failed', false);
  };
}

/* ---------------- Support placeholder ---------------- */
function renderSupport(){ app.innerHTML = `<div class="card"><h3>Support</h3><p class="small muted">For demo: support@demo-hdfc.local</p></div>`; }
