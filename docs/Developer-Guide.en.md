[中文](Developer-Guide) | **English**

> 🌐 This is a translation. The **Chinese version is authoritative** — if anything here conflicts with the [Chinese original](Developer-Guide), the Chinese version prevails, and translations may lag behind it.

# 📐 Workflow Development Overview (Developer Guide)

This page is for developers who **build** workflows — it is the entry point and map for all developer documentation.

## Mental Model: What You Are Developing

In Unigen, workflows exist as **code** (called **blueprints** in the UI) and are dynamically loadable. Choosing code over a configuration DSL is a deliberate decision: **so that the planner — not only humans — can modify workflows.** The planner improves a workflow precisely by editing its blueprint.

One thing to be clear about first: what runs inside Unigen is a **predefined workflow**, not an improvising autonomous agent (Agentic System). It belongs to the same family as Coze, Dify, and n8n — the difference being that **the workflows themselves are created and continuously updated by AI, constrained by a logical system, with "no hallucination, no drift" as the top goal** (see the positioning section on the [[Welcome|Home.en]] page).

"Developing a workflow" is itself a workflow, and therefore also a project type — in the current version, the **Workflow Studio** project type (used to build workflows and export them as new project types) has this capability built in.

## Two Core Working Surfaces

After opening a project, you work mainly in two places:

### The Reflection Assistant (expand from the right edge; requires an open project)

The command-style interaction entry point: run commands, dispatch tasks.

### The Blueprint (workflow details)

Click **Blueprint** to view and edit every detail of the workflow. Two things to note:

1. Your manual edits and the planner's automatic improvements act on **the same blueprint** — this shared substrate is what makes "humans can intervene + AI keeps improving" coexist.
2. The blueprint's user-facing configuration UI is described by a JSON tree — see [[Dynamic Panel JSON Guide|Panel-JSON.en]].

## The Path from Development to Publication

```
Workflow Studio → develop with the Reflection Assistant → polish the workflow in the Blueprint → validate with real runs → /export as a project type → publish to creators
```

## Approach Two: Planner Generation (Evolving)

Unigen's ultimate goal is for the planner to take over the creation, improvement, and maintenance of workflows. The planner roadmap advances in three stages — see the respective documents.

The shared stance across all three layers: **code as skeleton, LLM as filler** — structural legality (acyclicity, dependency closure, unified vocabulary) is hard-guaranteed by code, while LLMs handle only local semantics. This is how "zero tolerance for long-chain drift" is enforced in practice.

## Architecture at a Glance

- **Executor**: schedules and runs atomic actions, captures environment feedback, and owns production fault tolerance.
- **Planner**: compiles high-level intent into structurally legal task paths, landing them via blueprint edits. It does no work itself — it only compiles.
- **Execution history**: collected via OpenTelemetry-compatible endpoints; all improvements are grounded in real run records.

## Development Environment

- [[Local Setup|Local-Setup.en]] (includes complete Ubuntu build-from-source instructions)
