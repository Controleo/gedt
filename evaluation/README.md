# Evaluation kit (Chapter Five)

| File | What it is |
|---|---|
| `questionnaire_items.csv` | Every questionnaire item with its ID, section, criterion and wording |
| `response_template.csv` | The column headings your results file will use |
| `analyse_responses.py` | Turns the exported responses into means, standard deviations, Cronbach's alpha and percentages |
| `test_analyse.py` | Checks that the analysis arithmetic is correct. It uses made-up numbers only |
| (in `docs/`) | `GEDT_Evaluation_Pack.docx`, `GEDT_Quick_Start_Guide.docx`, `demo-video-script.md`, `DEPLOY.md` |

## How to use it
1. **Build the online questionnaire** (Google Forms or similar). Section A has 3 questions (A1 to A3), Section B has 20 rating questions, Section C has 6 rating questions and Section D has 2 open questions. Type the **question ID at the start of every question title**, for example `US1. I was able to complete the tasks...`. Use a **5-point scale from 1 (Strongly disagree) to 5 (Strongly agree)**. Put the consent statement first, with a required "I agree" tick.
2. **Put the system online** with `docs/DEPLOY.md` and add the practice routes with `npm run db:eval`.
3. **Invite practitioners.** Give each a participant number from 1 to 60, the web address, the task sheet and the questionnaire link. The target is at least 30 responses.
4. **Export the responses** as a CSV from the form.
5. **Analyse them:**
   ```
   python3 evaluation/analyse_responses.py responses.csv --out results
   ```
   The screen shows each criterion's mean, standard deviation and alpha, and says whether the targets (mean at least 3.5, alpha at least 0.70) are met. The folder `results/` receives three CSV files you can paste into Chapter Five tables.
6. **Report honestly.** Say how many people were invited and how many answered. Report criteria whose targets were not met. Remember the ratings are opinions of practitioners after a short trial.

## Checking the script
`python3 evaluation/test_analyse.py` should print `OK`. It checks alpha against a worked example and runs the whole analysis on invented numbers. Never put invented numbers in the report.
