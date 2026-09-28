---
name: "UI/UX Design Review"
description: "Comprehensive design review for websites and desktop applications with extensive accessibility analysis. Use this skill when users ask you to review UI/UX designs, wireframes, mockups, prototypes, or deployed interfaces for usability, accessibility (WCAG compliance), visual design, interaction patterns, responsive design, and best practices for web and desktop applications."
---

# UI/UX Design Review

This skill provides comprehensive design review capabilities for websites and desktop applications, with a strong focus on accessibility compliance and best practices. (Source: https://github.com/rknall/claude-skills/ui-design-review)

## When to Use This Skill

Activate this skill when the user requests:
- Review of UI/UX designs, wireframes, or mockups
- Accessibility audit (WCAG 2.1/2.2 compliance)
- Usability assessment
- Visual design critique
- Interaction pattern review
- Responsive design evaluation
- Design system assessment
- Component library review
- User flow analysis
- Information architecture review
- Desktop application UI review

## Review Framework

### 1. Initial Analysis

When a user provides a design or interface, begin by understanding context: target audience, platform(s), accessibility requirements, design system in use, browser/OS support, key user goals. If design artifacts (screenshots/prototypes) are provided, analyze visual hierarchy, color, typography, component consistency, navigation, states, responsive behavior.

### 2. Comprehensive Review Areas

#### A. Accessibility (WCAG 2.1/2.2 Compliance) — CRITICAL
- Text alternatives, semantic HTML, form labels programmatically associated
- Contrast: 4.5:1 normal text, 3:1 large text (AA); 7:1 (AAA)
- Keyboard accessible, no traps, logical focus order, visible focus
- Touch targets ≥ 44x44px; color not the sole means of conveying info
- Form errors identified and described; destructive actions confirmable

#### B. Visual Design & Aesthetics
- Visual hierarchy, layout structure, color palette, typography, white space, alignment
- Design token usage (colors, spacing, typography), component library consistency, pattern adherence

#### C. User Experience & Usability
- User flow logic, information architecture, cognitive load, error prevention/recovery, feedback
- Nielsen's 10 usability heuristics

#### D. Responsive Design & Layout
- Breakpoint strategy, touch targets, table handling on small screens, desktop window behavior

#### E. Typography & Readability
- Type scale and hierarchy, line height 1.5–1.8 body, minimum 16px body, heading hierarchy, ≤2–3 font families

#### F. Color & Contrast
- Palette cohesion, WCAG contrast, semantics, color-blindness safety, dark mode, consistent accent/action colors

#### G. Interactive Elements & Components
- Button styles and states (default/hover/focus/active/disabled/error), loading states, empty states, tooltips, modals
- All states designed; loading prevents double submission

#### H. Navigation & Information Architecture
- Primary/secondary navigation, breadcrumbs, shallow depth (≤3), highlight current location

#### I. Forms & Data Entry
- Label placement, no placeholder-as-label, inline validation, specific error messages, required indicators

#### J. Performance & Loading
- Loading indicators, skeleton screens, no blank screens, no layout shift

#### K. Content & Microcopy
- Action-oriented button labels, helpful error messages, consistent terminology, empty states

### 3. Review Output Format

Structure as: Executive Summary → Accessibility Analysis → Visual Design Assessment → UX & Usability → Responsive → Component & Pattern Review → Prioritized issues (Critical → Low) → Recommendations → Testing tools.

### 4. Priority Classification

- **CRITICAL / P0**: Prevents access to core functionality; WCAG Level A violations; broken core patterns
- **HIGH / P1**: Significantly impairs UX; WCAG AA violations; inconsistent core patterns
- **MEDIUM / P2**: Friction with workaround; visual inconsistencies; polish items
- **LOW / P3**: Refinement, edge cases, aesthetics

### 5. Communication Style

Be constructive and specific; explain user impact; give actionable recommendations with file references; prioritize clearly.
