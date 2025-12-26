// code structure was chatgpt generated
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "supersecret_change_this";

// helper
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id; email; role }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
// admin access
function adminOnly(req, res, next) {
  console.log("ADMIN CHECK req.user =", req.user);

  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}


// auth routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const hash = await bcrypt.hash(password, 10);

    const isAdmin = email === "wiktoria.role@admin.com";
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: hash,
        role: isAdmin ? "ADMIN" : "USER",
      },
      select: { id: true, name: true, email: true, role: true },
    });
    

    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// current user info
app.get("/api/me", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
  res.json(user);
});

// study sessions CRUD 

// upcoming sessions
app.get("/api/sessions", authRequired, async (req, res) => {
  const sessions = await prisma.studySession.findMany({
    where: { startTime: { gte: new Date() } },
    include: {
      createdBy: { select: { id: true, name: true } },
      participants: true,
    },
    orderBy: { startTime: "asc" },
  });
  res.json(sessions);
});

// create a new session
app.post("/api/sessions", authRequired, async (req, res) => {
  try {
    const {
      title,
      description,
      startTime,
      endTime,
      mode,
      maxParticipants,
      isPublic,
    } = req.body;

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: "title, startTime, endTime are required" });
    }

    const session = await prisma.studySession.create({
      data: {
        title,
        description,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        mode,
        maxParticipants,
        isPublic: isPublic ?? true,
        createdById: req.user.id,
        participants: {
          create: {
            userId: req.user.id,
            role: "HOST",
          },
        },
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        participants: true,
      },
    });

    res.status(201).json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// get one session
app.get("/api/sessions/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const session = await prisma.studySession.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      participants: {
        include: { user: { select: { id: true, name: true } } },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  if (!session) return res.status(404).json({ error: "Not found" });
  res.json(session);
});

// update session
app.put("/api/sessions/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);

  const existing = await prisma.studySession.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (existing.createdById !== req.user.id && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Not allowed" });
  }

  const { title, description, startTime, endTime, mode, maxParticipants, isPublic } =
    req.body;

  const session = await prisma.studySession.update({
    where: { id },
    data: {
      title,
      description,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      mode,
      maxParticipants,
      isPublic,
    },
  });

  res.json(session);
});

// delete session
app.delete("/api/sessions/:id", authRequired, async (req, res) => {
  const id = Number(req.params.id);

  const existing = await prisma.studySession.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (existing.createdById !== req.user.id && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Not allowed" });
  }

  await prisma.sessionParticipant.deleteMany({ where: { sessionId: id } });
  await prisma.message.deleteMany({ where: { sessionId: id } });
  await prisma.studySession.delete({ where: { id } });

  res.status(204).send();
});

// join sessions

app.post("/api/sessions/:id/join", authRequired, async (req, res) => {
  const sessionId = Number(req.params.id);

  try {
    const session = await prisma.studySession.findUnique({
      where: { id: sessionId },
      include: { participants: true },
    });

    if (!session) return res.status(404).json({ error: "Session not found" });

    if (
      session.maxParticipants &&
      session.participants.length >= session.maxParticipants
    ) {
      return res.status(400).json({ error: "Session is full" });
    }

    const participant = await prisma.sessionParticipant.upsert({
      where: {
        userId_sessionId: {
          userId: req.user.id,
          sessionId,
        },
      },
      update: {},
      create: {
        userId: req.user.id,
        sessionId,
        role: "PARTICIPANT",
      },
    });

    res.status(201).json(participant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// chat

app.post("/api/sessions/:id/messages", authRequired, async (req, res) => {
  const sessionId = Number(req.params.id);
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Content required" });

  try {
    // Optionally check if user is participant
    const message = await prisma.message.create({
      data: {
        content,
        userId: req.user.id,
        sessionId,
      },
      include: { user: { select: { id: true, name: true } } },
    });

    res.status(201).json(message);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// tasks

// get all tasks
app.get("/api/tasks", authRequired, async (req, res) => {
    try {
      const tasks = await prisma.task.findMany({
        where: { userId: req.user.id },
        orderBy: [
          { status: "asc" },       // TODO before DONE
          { dueDate: "asc" },      // earlier deadlines first
          { createdAt: "desc" },
        ],
      });
      res.json(tasks);
    } catch (err) {
      console.error("GET /api/tasks error", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  // create a new task
  app.post("/api/tasks", authRequired, async (req, res) => {
    try {
      const {
        title,
        description,
        type,      // TASK | EXAM | PROJECT | MEETING | OTHER
        subject,
        dueDate,
        priority,
      } = req.body;
  
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }
  
      const task = await prisma.task.create({
        data: {
          title,
          description,
          type,
          subject,
          dueDate: dueDate ? new Date(dueDate) : null,
          priority,
          userId: req.user.id,
        },
      });
  
      res.status(201).json(task);
    } catch (err) {
      console.error("POST /api/tasks error", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  // Update an existing task
  app.put("/api/tasks/:id", authRequired, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid id" });
      }
  
      // check task belongs to the current user
      const existing = await prisma.task.findUnique({ where: { id } });
      if (!existing || existing.userId !== req.user.id) {
        return res.status(404).json({ error: "Task not found" });
      }
  
      const {
        title,
        description,
        type,      // optional
        subject,
        dueDate,
        status,    // TODO | IN_PROGRESS | DONE
        priority,
      } = req.body;
  
      const updated = await prisma.task.update({
        where: { id },
        data: {
          title,
          description,
          type,
          subject,
          status,
          dueDate: dueDate ? new Date(dueDate) : existing.dueDate,
          priority,
        },
      });
  
      res.json(updated);
    } catch (err) {
      console.error("PUT /api/tasks/:id error", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  // delete a task
  app.delete("/api/tasks/:id", authRequired, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: "Invalid id" });
      }
  
      const existing = await prisma.task.findUnique({ where: { id } });
      if (!existing || existing.userId !== req.user.id) {
        return res.status(404).json({ error: "Task not found" });
      }
  
      await prisma.task.delete({ where: { id } });
  
      res.status(204).send();
    } catch (err) {
      console.error("DELETE /api/tasks/:id error", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  

// admin routes

// get all users
app.get("/api/admin/users", authRequired, adminOnly, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
    });
    res.json(users);
  } catch (err) {
    console.error("ADMIN users error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// delete a user
app.delete("/api/admin/users/:id", authRequired, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  // prevent deleting yourself
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete yourself" });
  }

  try {
    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    console.error("ADMIN delete user error", err);
    res.status(500).json({ error: "Server error" });
  }
});

//  AI helper

app.post("/api/ai/study-helper", authRequired, async (req, res) => {
  try {
    const { text, mode } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const input = text.toLowerCase();
    let result = "";

    // study tips
    if (mode === "tips") {
      const tips = [];

      tips.push("Break the topic into smaller study blocks");
      tips.push("Use active recall instead of rereading");
      tips.push("Study in short focused sessions (Pomodoro)");

      if (input.includes("exam") || input.includes("test")) {
        tips.push("Practice under timed exam conditions");
        tips.push("Focus on understanding concepts, not memorisation");
      }

      if (input.includes("vue")) {
        tips.push("Practice component structure and props");
        tips.push("Understand reactivity, refs, and computed values");
      }

      if (input.includes("express") || input.includes("backend")) {
        tips.push("Draw the request–response flow of your API");
        tips.push("Understand middleware and authentication");
      }

      if (input.includes("database") || input.includes("prisma")) {
        tips.push("Review data models and relationships");
        tips.push("Practice CRUD operations conceptually");
      }

      if (input.includes("project")) {
        tips.push("Break the project into tasks and prioritise core features");
      }

      if (input.includes("language") || input.includes("spanish")){
        tips.push("Watch The Language Tutor - Spanish; Spanish After Hours; AIB on Youtube");
        tips.push("Speak out loud");
        tips.push("Learn phrases, not just words");
        tips.push("Learn and understand high-value words like: ser, estar, tener, hacer, ir, decir, por, para, porque, pero");
      }
  
      if (input.includes("language") || input.includes("dutch")){
        tips.push("Watch Dutchies to be - Learn Dutch with Kim; Learn Dutch with DutchPod101.com; Easy Dutch on Youtube");
        tips.push("Speak out loud");
        tips.push("Learn phrases, not just words");
        tips.push("Learn and understand high-value words like: zijn, hebben, doen, gaan, zeggen, voor, omdat, maar, en, of");
      }
  
      if (input.includes("language") || input.includes("german")){
        tips.push("Watch Learn German; Easy German; Learn German Fast on Youtube");
        tips.push("Speak out loud");
        tips.push("Learn phrases, not just words");
        tips.push("Learn and understand high-value words like: sein, haben, machen, gehen, sagen, für, weil, aber, und, oder");
      }

      result = "Study tips based on your input:\n\n• " + tips.join("\n• ");
    }

    // summary
    else if (mode === "summary") {
      const sentences = text
        .replace(/\n/g, " ")
        .split(".")
        .map(s => s.trim())
        .filter(Boolean);

      if (sentences.length === 0) {
        result = "Summary:\nNo meaningful content detected.";
      } else {
        result =
          "Summary:\n" +
          sentences.slice(0, 3).join(". ") +
          ".";
      }
    }

    else {
      return res.status(400).json({ error: "Invalid mode" });
    }

    res.json({ result });

  } catch (err) {
    console.error("AI helper error:", err);
    res.status(500).json({ error: "AI processing failed" });
  }
});

// basic healthcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

module.exports = app;
