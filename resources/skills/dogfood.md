---
name: Web Application Exploratory Testing & Bug Hunting
description: Systematically explore and test a web application to find bugs, UX issues, and regressions. Use when asked to QA, dogfood, exploratory test, bug hunt, or evaluate the quality of a web application.
---

# Web Application Exploratory Testing & Dogfooding

Systematically explore a web application, find functional regressions and UX flaws, and produce actionable QA reports with structured reproduction steps.

## Workflow

```text
1. Initialize    Set up target session, output directory, and report file
2. Authenticate  Sign in or inject credentials if required
3. Orient        Navigate to initial landing page, inspect navigation hierarchy
4. Explore       Systematically test core flows, edge cases, and invalid inputs
5. Document      Record screenshots, console errors, and exact reproduction steps
6. Wrap Up       Summarize findings, categorize severity, and finalize report
```

## Exploratory Testing Checklist

When testing an application, examine these dimensions:

### 1. Navigation & Routing
- Are all navigation links and sub-routes functioning properly?
- Does browser back/forward preserve state or trigger broken screens?
- Do 404 pages render cleanly for non-existent paths?

### 2. Forms & Data Input
- Empty field validation: do required fields display clear inline errors?
- Boundary values: test extremely long strings, emojis, special characters, and numeric overflows.
- Double submission: does clicking submit multiple times create duplicate records?

### 3. Asynchronous States & Latency
- Do buttons show loading spinners or disable during pending requests?
- What happens if a network request fails (500 / 429 / offline)? Is an error message displayed?

### 4. Responsiveness & Visual Polish
- Test on desktop ($1440\times900$) and mobile viewports ($375\times812$).
- Look for horizontal overflow, clipped text, broken alignment, or overlapping elements.

## Structured Issue Report Format

For every bug identified, format findings with structured reproduction evidence:

```markdown
### [Bug ID] Brief Issue Description

- **Severity**: Critical | High | Medium | Low
- **Component / Route**: `/settings/profile`
- **Expected Behavior**: Changing email address should send a verification email and show success toast.
- **Actual Behavior**: The submit button remains in loading state indefinitely, and console logs 500 Internal Server Error.

#### Reproduction Steps
1. Navigate to `/settings/profile`.
2. Clear the email input and enter `test+new@example.com`.
3. Click "Save Changes".
4. Observe the indefinite spinner and network failure.

#### Evidence
- **Console Log**: `POST /api/user/email 500 (Internal Server Error)`
- **Screenshot**: `dogfood-output/screenshots/email-save-failure.png`
```
