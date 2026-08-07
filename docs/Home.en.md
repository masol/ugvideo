[中文](Home) | **English**

> 🌐 This is a translation. The **Chinese version is authoritative** — if anything here conflicts with the [Chinese original](Home), the Chinese version prevails, and translations may lag behind it.

# 🎯 Welcome to Unigen

**Unigen (Uniform Generation) lets AI complete complex, long-horizon tasks at human quality.**

From a script to a finished video. From one idea to an entire novel. From requirements to runnable code. What these tasks have in common:

- **The workflow is genuinely complex** — dozens to hundreds of steps, multiple kinds of intermediate artifacts;
- **The workflow changes infrequently** — but the quality bar is extremely high;
- **Time is not the constraint** — a single run taking days or even weeks is acceptable, **as long as quality never collapses**.

Today's mainstream ReAct-style agents are a poor fit here: a single execution is too long to gather feedback by acting one step at a time, and for sufficiently complex workflows, quality evaluation is itself a major open topic. Unigen takes a different road — **separate planning from execution; code as skeleton, LLM as filler; zero tolerance for long-chain drift.**

## What This Is: A Predefined Workflow, Not an Autonomous Agent

What runs inside Unigen is not an "LLM-driven autonomous agent" (an Agentic System like OpenClaw or Hermes that improvises step by step and re-explores every time) — it is a **predefined workflow pipeline**. It belongs to the same family as Coze, Dify, and n8n; if you don't care about the internals, just treat it as an alternative to those platforms. The one difference that matters: its workflows aim above all for **no hallucination, no drift**, rather than for flexible autonomy.

Two things set it apart from those platforms:

1. Workflows are **created and continuously updated by AI**, and that creation and updating is constrained by a logical system (if you don't care about the principle, think of it as a mechanism that makes workflows more stable).
2. A workflow's hallucination probability can be **evaluated in a stable, computable way** — even when maintained by a human, there is a deterministic method to estimate how likely it is to go wrong (again, if you don't care about the principle, treat it as a set of predefined workflow techniques).

In one line: you get a pipeline that reliably runs to completion, not an agent that re-explores from scratch every time. If its workflows feel more stable and less hallucination-prone to you than those platforms', the positioning holds — and that is exactly the goal.

---

## Which Kind of User Are You?

Unigen explicitly serves two audiences — please enter through the matching door:

### 🎨 I'm a creator — I want to make things with workflows

You are a video creator, a novelist, or anyone who wants AI to do big work at high quality. What you need is a **mature workflow that is flexible and locally adjustable** — whether it was evolved by AI or written by hand is not your concern.

→ Start with [[Getting Started|Getting-Started.en]] and [[Running Your First Workflow|Using-Workflows.en]].

### 🧩 I'm a developer — I want to build / evolve workflows

You want to build high-determinism long-chain workflows for a domain, or you are interested in the direction itself: letting a planner automatically generate and improve workflows. Unigen gives you:

- A **code-based**, dynamically loadable workflow runtime;
- A built-in long-chain development method: [[Prism: Multi-Facet Critique-Refinement|prism.en]];
- A clear planner evolution path: [[Loom: Graph-Blackboard Planning|loom.en]] → [[HTN/HDDL Symbolic Planning|planner.en]].

→ Start with [[Workflow Development Overview|Developer-Guide.en]].

---

## Project Philosophy: Iterate on Records, Not Guesses

Unigen workflows are **readable, editable, publishable** structures that humans can step into directly; all execution history is collected and retained via OpenTelemetry-compatible endpoints, serving as the evidence base for human or AI improvement.

The evolution path (see [[Roadmap|Roadmap.en]]):

> Carry workflows of real practical value (primarily hand-written)
> → Planner-assisted generation and improvement
> → **Ultimate goal: fully automatic improvement with no human in the loop.**

## Project Status

Early stage. The core runtime is usable: an Electron desktop app (Windows / Linux / macOS), with portable builds downloadable from Releases. Currently ships with a runnable **Script-to-Video** project type (AI-generated and only verified to be runnable — not yet deeply polished; see the caveats in [[Getting Started|Getting-Started.en]]) and a **Workflow Studio** project type (for developers — the project type used to build workflows and export them as new project types).

The built-in reasoning methods can be tried directly in the Reflection Assistant;
the planner is progressing through three stages — Prism → Loom → HTN — with each stage's status documented on its own page.
