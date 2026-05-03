# Ready Google Forms Blueprint

Survey title: Panahon LGU Dashboard Usability Survey (Short)
Suggested form description:
This survey evaluates the usability of the Panahon LGU dashboard as a website-based decision support tool. Responses are for research and system improvement only.
Estimated time: 5-7 minutes.

Recommended add-on to form description (copy as-is):
Panahon is a web-based monitoring and decision-support project for LGU operations.
This survey is part of the project evaluation phase.
Participation is voluntary, and responses are analyzed in aggregate for academic/research purposes.
No sensitive personal data is required.
For concerns, contact: [Insert researcher email] / [Insert adviser or institution contact].

---

## 1) Google Forms Settings

## General
- Collect email addresses: Optional (recommended OFF for anonymity)
- Limit to 1 response: Optional (turn ON only if organizational policy requires sign-in)
- Edit after submit: OFF
- See summary charts/text responses: OFF

## Presentation
- Show progress bar: ON
- Shuffle question order: OFF
- Confirmation message:
  Thank you for your feedback. Your response has been recorded.

## Responses
- Link to Google Sheets: ON
- Accepting responses: ON

---

## 2) Section Structure and Logic

Create 5 sections in this exact order:
1. Consent and Intro
2. Quick Context
3. Website and Dashboard Usability
4. Standardized Usability Check and Overall Rating
5. Open Feedback

Branching rule:
- If Q1 = No (I do not agree), go to Submit form.
- If Q1 = Yes (I agree), continue to Section 2.

---

## 3) Exact Question Blueprint

Use the exact question wording below.

## Section 1: Consent and Intro

Section description (add in Google Forms):
This study evaluates the Panahon LGU dashboard's usability in real LGU workflows.
Participation is voluntary. You may stop before submitting.
Only minimum non-sensitive data is collected for research.
Results are reported in aggregate, and access to raw responses is limited to the research team.
By selecting Yes, you confirm that you are at least 18 years old (or covered by your institution's approved consent process) and agree to participate.

Q1
- Type: Multiple choice
- Required: Yes
- Prompt: I agree to participate in this study.
- Choices:
  - Yes, I agree
  - No, I do not agree
- Go to section based on answer:
  - Yes, I agree -> Section 2
  - No, I do not agree -> Submit form

---

## Section 2: Quick Context

Q2
- Type: Multiple choice
- Required: Yes
- Prompt: What is your current LGU role?
- Choices:
  - DRRM/Ops staff
  - Supervisor/Decision-maker
  - Technical support
  - Other

Q3
- Type: Multiple choice
- Required: Yes
- Prompt: How often do you use the dashboard?
- Choices:
  - Daily
  - 3-5 times per week
  - 1-2 times per week
  - Less than weekly

Q4
- Type: Multiple choice
- Required: Yes
- Prompt: What device do you usually use to access the dashboard?
- Choices:
  - Desktop/Laptop
  - Mobile phone
  - Tablet
  - Mixed devices

---

## Section 3: Website and Dashboard Usability

Instruction text (add as section description):
For the following statements, choose one answer from 1 (Strongly disagree) to 5 (Strongly agree).

For Q5-Q12:
- Type: Multiple choice grid
- Required: Yes (require a response in each row)
- Rows:
  - Navigation is consistent and predictable across dashboard pages.
  - Labels and terms are clear for LGU work (no confusing jargon).
  - I can quickly find the information I need.
  - Key metrics are visible at a glance on the dashboard.
  - Charts and tables are easy to read and interpret.
  - Alert information is clear enough for action/coordination.
  - The dashboard works well on my usual device and screen size.
  - The interface is clean and not cluttered.
- Columns:
  - 1 Strongly disagree
  - 2 Disagree
  - 3 Neutral
  - 4 Agree
  - 5 Strongly agree

---

## Section 4: Standardized Usability Check and Overall Rating

Instruction text (add as section description):
Please use the same 1 to 5 agreement scale.

Q13
- Type: Linear scale
- Required: Yes
- Prompt: This dashboard's capabilities meet my operational requirements.
- Scale: 1 to 5
- Label 1: Strongly disagree
- Label 5: Strongly agree

Q14
- Type: Linear scale
- Required: Yes
- Prompt: This dashboard is easy to use.
- Scale: 1 to 5
- Label 1: Strongly disagree
- Label 5: Strongly agree

Q15
- Type: Linear scale
- Required: Yes
- Prompt: Overall usability rating of the dashboard
- Scale: 0 to 10
- Label 0: Very poor
- Label 10: Excellent

---

## Section 5: Open Feedback

Q16
- Type: Paragraph
- Required: No
- Prompt: What is the biggest usability issue you face most often?

Q17
- Type: Paragraph
- Required: No
- Prompt: What top improvements should be prioritized first?

---

## 4) Response Sheet Scoring Columns (Optional but Recommended)

After linking to Google Sheets, add these columns:
- B_mean_usability
- C_umux_lite_mean
- D_overall_0_10

Assuming column mapping is:
- Q5-Q12 in columns E to L (1-5 values)
- Q13 in M
- Q14 in N
- Q15 in O

Use formulas in row 2:
- B_mean_usability:
  =AVERAGE(E2:L2)
- C_umux_lite_mean:
  =AVERAGE(M2:N2)
- D_overall_0_10:
  =O2

Interpretation guideline:
- 4.2 to 5.0: strong usability
- 3.4 to 4.1: acceptable, with improvement areas
- below 3.4: significant usability concerns

---

## 5) Build Checklist (Quick QA Before Sending)

- Branching works: No consent ends survey.
- All required items are truly required (Q1-Q15).
- Grid rows are all mandatory.
- Scale labels appear correctly (especially 0-10 and 1-5).
- Form is readable on mobile preview.
- Confirmation message is visible.
- Test submission appears correctly in Sheets.

---

## 6) Distribution Template (Optional)

Subject: Request for Feedback - Panahon LGU Dashboard Usability Survey

Message:
Good day. We are conducting a short usability survey for the Panahon LGU dashboard.
Your feedback will directly support improvements in dashboard clarity, navigation, and operational usefulness.
Estimated completion time is 5-7 minutes.

Survey link: [Insert Google Form URL]
Thank you for your participation.
