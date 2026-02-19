const API = "http://localhost:4567/api";

async function loadAccounts() {
  const res = await fetch(`${API}/accounts`);
  const data = await res.json();
  const body = document.querySelector("#accountsTable tbody");
  body.innerHTML = "";
  data.forEach(acc => {
    body.innerHTML += `
      <tr>
        <td>${acc.accNo}</td>
        <td>${acc.name}</td>
        <td>₹${acc.balance.toFixed(2)}</td>
        <td>
          <button onclick="delAcc(${acc.accNo})" class="del-btn">Delete</button>
        </td>
      </tr>`;
  });
}

async function delAcc(accNo) {
  if (!confirm("Delete account " + accNo + "?")) return;
  await fetch(`${API}/accounts/${accNo}`, { method: "DELETE" });
  loadAccounts();
}

document.getElementById("createAccountForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const accNo = parseInt(document.getElementById("accNo").value);
  const name = document.getElementById("name").value;
  const balance = parseFloat(document.getElementById("balance").value);

  const res = await fetch(`${API}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accNo, name, balance })
  });
  await res.json();
  loadAccounts();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("user");
  window.location.href = "login.html";
});

loadAccounts();
gsap.from(".admin-dashboard", { duration: 1, opacity: 0, y: 40, ease: "power3.out" });
