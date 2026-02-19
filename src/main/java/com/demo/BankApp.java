package com.demo;

import static spark.Spark.*;
import com.google.gson.*;
import java.util.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * BankApp - demo banking backend with persistence, payments (transfer + UPI), cards
 * Not production-grade; for demonstration only.
 */
public class BankApp {
    static final String DB_FILE = "accounts.json";
    static Gson gson = new GsonBuilder().setPrettyPrinting().create();
    static Map<Integer, Account> accounts = new HashMap<>();
    static final String ADMIN_PASSWORD = "admin123";

    public static void main(String[] args) {
        port(4567);
        staticFiles.location("/public"); // serves frontend

        loadDB();

        // Ensure some demo accounts exist
        if (!accounts.containsKey(1001)) {
            accounts.put(1001, new Account(1001, "Amit Sharma", 5000, sha256("pass123")));
        }
        if (!accounts.containsKey(1002)) {
            accounts.put(1002, new Account(1002, "Neha Verma", 8000, sha256("pass123")));
        }
        saveDB();

        // CORS for local dev (optional)
        options("/*", (req, res) -> {
            String h = req.headers("Access-Control-Request-Headers");
            if (h != null) res.header("Access-Control-Allow-Headers", h);
            String m = req.headers("Access-Control-Request-Method");
            if (m != null) res.header("Access-Control-Allow-Methods", m);
            return "OK";
        });

        before((req, res) -> res.type("application/json"));

        // --- Auth / Login ---
        post("/api/login", (req, res) -> {
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            if (obj == null) return jsonError("invalid_request");
            String role = obj.has("role") ? obj.get("role").getAsString() : "customer";
            if ("admin".equals(role)) {
                String pass = obj.has("password") ? obj.get("password").getAsString() : "";
                if (ADMIN_PASSWORD.equals(pass)) {
                    return gson.toJson(Map.of("status", "ok", "role", "admin"));
                } else return jsonError("invalid_admin_credentials");
            } else {
                if (!obj.has("accNo") || !obj.has("password")) return jsonError("missing_fields");
                int accNo = obj.get("accNo").getAsInt();
                String pass = obj.get("password").getAsString();
                Account a = accounts.get(accNo);
                if (a == null) return jsonError("invalid_credentials");
                if (!a.passwordHash.equals(sha256(pass))) return jsonError("invalid_credentials");
                return gson.toJson(Map.of("status", "ok", "account", a));
            }
        });

        // --- Accounts CRUD / list ---
        get("/api/accounts", (req, res) -> gson.toJson(accounts.values()));

        post("/api/accounts", (req, res) -> {
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            if (obj == null || !obj.has("name") || !obj.has("balance"))
                return jsonError("missing_fields");
            String name = obj.get("name").getAsString();
            double balance = obj.get("balance").getAsDouble();
            String plainPassword = obj.has("password") && !obj.get("password").getAsString().isEmpty()
                    ? obj.get("password").getAsString()
                    : "pass123";
            int accNo = generateAccountNumber();
            Account a = new Account(accNo, name, balance, sha256(plainPassword));
            a.transactions.add(new Transaction("OPEN", balance, balance, "Account opened"));
            synchronized (accounts) {
                accounts.put(accNo, a);
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "account", a));
        });

        get("/api/accounts/:id", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            return gson.toJson(a);
        });

        delete("/api/accounts/:id", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            synchronized (accounts) {
                if (accounts.remove(id) != null) {
                    saveDB();
                    return gson.toJson(Map.of("status", "ok"));
                } else return jsonError("not_found");
            }
        });

        // --- deposit ---
        post("/api/accounts/:id/deposit", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            double amt = obj.get("amount").getAsDouble();
            if (amt <= 0) return jsonError("invalid_amount");
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            synchronized (a) {
                a.balance += amt;
                a.transactions.add(new Transaction("DEPOSIT", amt, a.balance, obj.has("note") ? obj.get("note").getAsString() : ""));
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "balance", a.balance));
        });

        // --- withdraw (server still has endpoint but frontend removed withdraw button) ---
        post("/api/accounts/:id/withdraw", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            double amt = obj.get("amount").getAsDouble();
            if (amt <= 0) return jsonError("invalid_amount");
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            synchronized (a) {
                if (a.balance < amt) return jsonError("insufficient");
                a.balance -= amt;
                a.transactions.add(new Transaction("WITHDRAW", amt, a.balance, obj.has("note") ? obj.get("note").getAsString() : ""));
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "balance", a.balance));
        });

        // --- add interest ---
        post("/api/accounts/:id/add-interest", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            synchronized (a) {
                double interest = a.balance * 0.05; // 5% demo
                a.balance += interest;
                a.transactions.add(new Transaction("INTEREST", interest, a.balance, "Interest credited"));
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "balance", a.balance));
        });

        // --- transfer (payments) ---
        post("/api/accounts/:id/transfer", (req, res) -> {
            int fromId = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            if (!obj.has("target") || !obj.has("amount")) return jsonError("missing_fields");
            int toId = obj.get("target").getAsInt();
            double amt = obj.get("amount").getAsDouble();
            if (amt <= 0) return jsonError("invalid_amount");
            Account from = accounts.get(fromId);
            Account to = accounts.get(toId);
            if (from == null || to == null) return jsonError("not_found");
            synchronized (accounts) { // synchronize to avoid race
                if (from.balance < amt) return jsonError("insufficient");
                from.balance -= amt;
                to.balance += amt;
                from.transactions.add(new Transaction("TRANSFER_OUT", amt, from.balance, "To " + toId));
                to.transactions.add(new Transaction("TRANSFER_IN", amt, to.balance, "From " + fromId));
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "fromBalance", from.balance, "toBalance", to.balance));
        });

        // --- UPI payment (payer uses UPI ID to send to another VPA/external) ---
        post("/api/accounts/:id/upi", (req, res) -> {
            int fromId = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            if (!obj.has("upiId") || !obj.has("amount")) return jsonError("missing_fields");
            String upiId = obj.get("upiId").getAsString();
            double amt = obj.get("amount").getAsDouble();
            String note = obj.has("note") ? obj.get("note").getAsString() : "UPI payment to " + upiId;
            if (amt <= 0) return jsonError("invalid_amount");
            Account from = accounts.get(fromId);
            if (from == null) return jsonError("not_found");
            synchronized (from) {
                if (from.balance < amt) return jsonError("insufficient");
                from.balance -= amt;
                from.transactions.add(new Transaction("UPI_OUT", amt, from.balance, note));
                saveDB();
            }
            // In demo we don't route to the UPI receiver; we just deduct and record
            return gson.toJson(Map.of("status", "ok", "balance", from.balance));
        });

        // --- Cards: list and request new card ---
        get("/api/accounts/:id/cards", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            return gson.toJson(a.cards);
        });

        post("/api/accounts/:id/cards", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            String type = obj.has("type") ? obj.get("type").getAsString() : "DEBIT";
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            Card c = generateCard(type);
            synchronized (a) {
                a.cards.add(c);
                a.transactions.add(new Transaction("CARD_ISSUE", 0.0, a.balance, "Card issued: " + maskCard(c.number)));
                saveDB();
            }
            return gson.toJson(Map.of("status", "ok", "card", c));
        });

        // --- change password ---
        post("/api/accounts/:id/change-password", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            JsonObject obj = gson.fromJson(req.body(), JsonObject.class);
            if (!obj.has("current") || !obj.has("new")) return jsonError("missing_fields");
            String cur = obj.get("current").getAsString();
            String nw = obj.get("new").getAsString();
            Account a = accounts.get(id);
            if (a == null) return jsonError("not_found");
            if (!a.passwordHash.equals(sha256(cur))) return jsonError("wrong_current");
            a.passwordHash = sha256(nw);
            saveDB();
            return gson.toJson(Map.of("status", "ok"));
        });

        // --- CSV statement endpoint ---
        get("/api/accounts/:id/statement", (req, res) -> {
            int id = Integer.parseInt(req.params("id"));
            Account a = accounts.get(id);
            if (a == null) { res.type("text/plain"); return "Account not found"; }
            StringBuilder sb = new StringBuilder();
            sb.append("date,type,amount,balanceAfter,note\n");
            for (Transaction t : a.transactions) {
                sb.append(String.format("\"%s\",%s,%.2f,%.2f,\"%s\"\n", t.date, t.type, t.amount, t.balanceAfter, t.note == null ? "" : t.note.replace("\"","\"\"")));
            }
            res.type("text/csv");
            res.header("Content-Disposition", "attachment; filename=statement_" + id + ".csv");
            return sb.toString();
        });

        // health
        get("/api/health", (req, res) -> gson.toJson(Map.of("status", "ok")));

        System.out.println("✅ Demo bank server running at http://localhost:4567/login.html");
    }

    // ------------------ Utilities ------------------
    static void loadDB() {
        try {
            Path p = Paths.get(DB_FILE);
            if (!Files.exists(p)) return;
            String json = Files.readString(p);
            Account[] arr = gson.fromJson(json, Account[].class);
            accounts.clear();
            if (arr != null) for (Account a : arr) accounts.put(a.accNo, a);
            System.out.println("Loaded DB: " + accounts.size() + " accounts");
        } catch (Exception e) {
            System.err.println("loadDB error: " + e.getMessage());
        }
    }

    static void saveDB() {
        try {
            Account[] arr = accounts.values().toArray(new Account[0]);
            String json = gson.toJson(arr);
            Files.writeString(Paths.get(DB_FILE), json, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        } catch (Exception e) {
            System.err.println("saveDB error: " + e.getMessage());
        }
    }

    static int generateAccountNumber() {
        Random r = new Random();
        int acc;
        synchronized (accounts) {
            do { acc = 1000 + r.nextInt(9000); } while (accounts.containsKey(acc));
        }
        return acc;
    }

    static String jsonError(String m) {
        return gson.toJson(Map.of("status", "error", "message", m));
    }

    static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] b = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    // ------------------ Card utilities ------------------
    static Card generateCard(String type) {
        String number = generateCardNumber();
        String expiry = generateExpiry();
        String cvv = String.format("%03d", new Random().nextInt(900) + 100);
        String cardId = UUID.randomUUID().toString();
        return new Card(cardId, maskCard(number), number, expiry, cvv, type.toUpperCase(), "ACTIVE");
    }

    static String generateCardNumber() {
        // generate pseudo 16-digit starting with 4 (Visa-like) for demo
        Random r = new Random();
        StringBuilder sb = new StringBuilder();
        sb.append('4');
        for (int i = 0; i < 15; i++) sb.append(r.nextInt(10));
        return sb.toString();
    }

    static String generateExpiry() {
        LocalDateTime now = LocalDateTime.now();
        int m = now.getMonthValue();
        int y = now.getYear() + 4; // 4 years validity
        return String.format("%02d/%02d", m, y % 100);
    }

    static String maskCard(String digits) {
        if (digits == null || digits.length() < 8) return digits;
        return "**** **** **** " + digits.substring(digits.length() - 4);
    }

    // ------------------ Data classes ------------------
    static class Account {
        int accNo;
        String name;
        double balance;
        String passwordHash;
        List<Transaction> transactions = new ArrayList<>();
        List<Card> cards = new ArrayList<>();

        Account() {}

        Account(int accNo, String name, double balance, String passwordHash) {
            this.accNo = accNo;
            this.name = name;
            this.balance = balance;
            this.passwordHash = passwordHash;
        }
    }

    static class Transaction {
        String date;
        String type;
        double amount;
        double balanceAfter;
        String note;

        Transaction() {}

        Transaction(String type, double amount, double balanceAfter, String note) {
            this.date = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
            this.type = type;
            this.amount = amount;
            this.balanceAfter = balanceAfter;
            this.note = note;
        }
    }

    static class Card {
        String id;         // internal id
        String masked;     // masked shown number
        String number;     // full number (in demo stored in plain text; do NOT do this in production)
        String expiry;
        String cvv;
        String type;       // DEBIT / CREDIT
        String status;     // ACTIVE / BLOCKED

        Card() {}

        Card(String id, String masked, String number, String expiry, String cvv, String type, String status) {
            this.id = id;
            this.masked = masked;
            this.number = number;
            this.expiry = expiry;
            this.cvv = cvv;
            this.type = type;
            this.status = status;
        }
    }
}
