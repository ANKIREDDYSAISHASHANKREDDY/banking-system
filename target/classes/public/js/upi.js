// upi.js - handles Static & Dynamic QR generation and dynamic Pay Now (calls /api/accounts/:id/upi)

const API = "/api";
let qrInstance = null;

// helpers
function el(id){ return document.getElementById(id); }
function clearQR() {
  const container = el('qrcode');
  container.innerHTML = '';
  qrInstance = null;
  el('qrInfo').textContent = 'QR cleared';
}
function generateUPIURI({ pa, pn, am, tn, cu='INR' }) {
  // pa = payee address (UPI id), pn = payee name, am = amount, tn = txn note, cu = currency
  // Basic UPI deep link format:
  // upi://pay?pa=merchant@bank&pn=Merchant%20Name&am=10.00&tn=note&cu=INR
  const params = new URLSearchParams();
  if (pa) params.set('pa', pa);
  if (pn) params.set('pn', pn);
  if (am) params.set('am', Number(am).toFixed(2));
  if (tn) params.set('tn', tn);
  params.set('cu', cu);
  return `upi://pay?${params.toString()}`;
}

function renderQRCode(text) {
  const container = el('qrcode');
  container.innerHTML = '';
  qrInstance = new QRCode(container, {
    text: text,
    width: 220,
    height: 220,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
  el('qrInfo').textContent = text;
}

// mode switches
el('modeStatic').addEventListener('click', ()=> {
  el('staticSection').style.display = 'block';
  el('dynamicSection').style.display = 'none';
  el('staticMsg').textContent = '';
  el('dynMsg').textContent = '';
  clearQR();
});
el('modeDynamic').addEventListener('click', ()=> {
  el('staticSection').style.display = 'none';
  el('dynamicSection').style.display = 'block';
  clearQR();
});

// Static QR generation
el('genStatic').addEventListener('click', ()=> {
  const upiId = el('stat_upiId').value.trim();
  const amt = el('stat_amt').value;
  const note = el('stat_note').value.trim();
  if (!upiId) { el('staticMsg').textContent = 'Enter merchant UPI ID'; el('staticMsg').style.color='crimson'; return; }
  const uri = generateUPIURI({ pa: upiId, am: amt || undefined, tn: note || undefined });
  renderQRCode(uri);
  el('staticMsg').textContent = 'Static QR generated';
  el('staticMsg').style.color='green';
});

// Download static QR
el('downloadStatic').addEventListener('click', ()=> {
  if (!qrInstance) return alert('Generate a QR first');
  downloadQRCodeAsPNG(el('qrcode').querySelector('img') || el('qrcode').querySelector('canvas'), 'upi_static.png');
});

// Dynamic: live QR update while typing
['dyn_upiId','dyn_amt','dyn_note'].forEach(id => {
  el(id).addEventListener('input', ()=> {
    const upiId = el('dyn_upiId').value.trim();
    const amt = el('dyn_amt').value;
    const note = el('dyn_note').value.trim();
    if (!upiId) { clearQR(); el('dynMsg').textContent = 'Enter receiver UPI ID'; el('dynMsg').style.color='crimson'; return; }
    const uri = generateUPIURI({ pa: upiId, am: amt || undefined, tn: note || undefined });
    renderQRCode(uri);
    el('dynMsg').textContent = 'QR updated';
    el('dynMsg').style.color='green';
  });
});

// download dynamic QR
el('downloadDyn').addEventListener('click', ()=> {
  if (!qrInstance) return alert('Generate a QR first');
  downloadQRCodeAsPNG(el('qrcode').querySelector('img') || el('qrcode').querySelector('canvas'), 'upi_dynamic.png');
});

// Clear QR
el('clearQr').addEventListener('click', clearQR);

// Pay Now (dynamic sender) - debits the logged-in account
el('payNow').addEventListener('click', async ()=> {
  const upiId = el('dyn_upiId').value.trim();
  const amt = parseFloat(el('dyn_amt').value);
  const note = el('dyn_note').value.trim();
  const msg = el('dynMsg');
  if (!upiId || !amt || amt <= 0) { showMsg(msg, 'Enter valid details', false); return; }

  // get logged-in user
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user || user.role !== 'customer') { alert('You must be logged in as a customer to pay.'); window.location.href='login.html'; return; }
  const accNo = user.accNo;

  // call backend endpoint
  try {
    const res = await fetch(`${API}/accounts/${accNo}/upi`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ upiId, amount: amt, note })
    });
    const j = await res.json();
    if (j.status === 'ok') {
      showMsg(msg, 'Payment successful', true);
      // update UI: show updated balance by fetching account
      const accRes = await fetch(`${API}/accounts/${accNo}`);
      const acc = await accRes.json();
      // optionally redirect to dashboard or update stored account (if SPA)
      alert(`Payment successful. New balance: ₹${Number(acc.balance).toFixed(2)}`);
      // refresh localStorage user (if needed)
      window.location.href = 'index.html';
    } else {
      showMsg(msg, j.message || 'Payment failed', false);
    }
  } catch (err) {
    console.error(err);
    showMsg(msg, 'Network or server error', false);
  }
});

// helper: download QR image (canvas or img)
function downloadQRCodeAsPNG(elNode, filename='qr.png') {
  if (!elNode) { alert('No QR to download'); return; }
  if (elNode.tagName.toLowerCase() === 'img') {
    const url = elNode.src;
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  } else if (elNode.tagName.toLowerCase() === 'canvas') {
    const url = elNode.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  } else {
    // some implementations create canvas inside a wrapper
    const canvas = el('qrcode').querySelector('canvas');
    if (!canvas) return alert('No QR canvas found');
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  }
}

// small message helper
function showMsg(el, msg, ok=true) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? 'green' : 'crimson';
}
