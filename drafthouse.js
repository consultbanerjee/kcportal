'use strict';
// Drafting knowledge for the Portal AI: page/format profiles, document kinds, and the house style the AI must follow.

// ---- page + typography profiles (inches / points) ----
const PAGES = { A4: { w: 595.28, h: 841.89, label: 'A4' }, Legal: { w: 612, h: 1008, label: 'Legal' } };
const PROFILES = {
  // Calcutta High Court: Gazette notification of 18 Feb 2020 (No. 584-G), Appellate and Original Side
  hc: { label: 'Calcutta High Court (A4 · Times New Roman 14 · 1.5 spacing)', font: 'Times New Roman', size: 14, spacing: 1.5, m: { top: 1.5, bottom: 1.5, left: 1.75, right: 1.0 }, annex: 'P' },
  // district courts / suits on Legal paper (same type as HC unless the firm changes it)
  court: { label: 'Civil / criminal court (Times New Roman 14 · 1.5 spacing)', font: 'Times New Roman', size: 14, spacing: 1.5, m: { top: 1.5, bottom: 1.5, left: 1.75, right: 1.0 }, annex: 'A' },
  // DRT / tribunals (saved preference of the firm)
  tribunal: { label: 'DRT / Tribunal (Bookman Old Style 12 · 1-inch margins)', font: 'Bookman Old Style', size: 12, spacing: 1.5, m: { top: 1, bottom: 1, left: 1, right: 1 }, annex: 'A' },
  // notices and letters go on the firm's letter pad
  letter: { label: 'Notice / letter (Times New Roman 12 · letter pad)', font: 'Times New Roman', size: 12, spacing: 1.15, m: { top: 1, bottom: 1, left: 1, right: 1 }, annex: 'A', letterhead: true },
};

// kind -> { label, profile, page: 'A4' | 'Legal' | null (null = user chooses), what }
const KINDS = {
  writ_petition: { label: 'Writ Petition (Calcutta High Court)', profile: 'hc', page: 'A4', annexures: true, what: 'a Writ Petition for the High Court at Calcutta in the firm\'s standing writ format' },
  suit: { label: 'Suit / Plaint', profile: 'court', page: 'Legal', annexures: true, what: 'a Plaint (civil suit) with valuation, jurisdiction, cause of action, prayers, list of documents, verification and affidavit' },
  appeal: { label: 'Appeal / Revision / Memorandum of appeal', profile: 'hc', page: null, annexures: true, what: 'a Memorandum of Appeal or Revision Petition with the order under challenge, facts, grounds, limitation, prayer, verification' },
  application: { label: 'Application / Petition (any court or tribunal)', profile: 'court', page: null, annexures: true, what: 'an Application / Petition in the cause title of the forum named in the instruction (interlocutory, condonation, restoration, interim relief etc.)' },
  drt_tribunal: { label: 'DRT / NCLT / Tribunal pleading', profile: 'tribunal', page: null, annexures: true, what: 'a pleading for the Debts Recovery Tribunal / NCLT / other tribunal named in the instruction' },
  written_statement: { label: 'Written Statement / Reply / Affidavit in opposition', profile: 'court', page: null, annexures: true, what: 'a Written Statement / para-wise reply / affidavit in opposition' },
  bail: { label: 'Bail application', profile: 'court', page: null, annexures: true, what: 'a Bail Application (facts, grounds, conditions offered, prayer)' },
  fir_complaint: { label: 'FIR complaint', profile: 'court', page: null, annexures: true, what: 'a written complaint for lodging an FIR (to the Officer-in-Charge) with the table of BNS sections and prayer' },
  legal_notice: { label: 'Legal notice (on letter pad)', profile: 'letter', page: null, annexures: false, what: 'a Legal Notice (advocate notice on behalf of the client, with facts, legal basis, demand, time limit and consequences)' },
  reply_notice: { label: 'Reply to a legal notice (on letter pad)', profile: 'letter', page: null, annexures: false, what: 'a Reply to a Legal Notice (para-wise reply, denials, own case, reservation of rights)' },
  letter: { label: 'Letter (on letter pad)', profile: 'letter', page: null, annexures: false, what: 'a formal Letter' },
  agreement: { label: 'Agreement / Deed', profile: 'court', page: null, annexures: false, what: 'an Agreement / Deed (parties, recitals, operative clauses, schedules, execution)' },
  affidavit: { label: 'Affidavit', profile: 'court', page: null, annexures: false, what: 'an Affidavit (deponent particulars, numbered statements, verification)' },
  other: { label: 'Other legal document', profile: 'court', page: null, annexures: true, what: 'the legal document described in the instruction' },
};

// ---- the output markup the AI writes (plain text; the portal turns it into Word and PDF) ----
const MARKUP = `OUTPUT MARKUP (plain text only; never use markdown symbols such as #, *, _ or backticks):
- A normal paragraph is just text. Separate paragraphs with a blank line. Number paragraphs yourself ("1. That ...").
- A line starting "@C " is centred; "@CB " is centred and bold; "@R " is right-aligned; "@B " is a bold left-aligned line; "@L " is a left-aligned line with no indent (cause-title lines, addresses, signature blocks); "@I " is a justified paragraph with no first-line indent.
- "@PB" alone on a line is a page break.
- Tables: each row is a line "@T cell | cell | cell"; the first row of a table should be "@TH cell | cell | cell" (header). Keep consecutive rows together.
- Page numbering: "@NONUM" alone on a line starts a new page whose pages carry no page number (cover page, index, list of dates, synopsis, points of law). "@NUM" alone starts a new page and restarts numbering at "Page 1" (the petition proper through the affidavit). If you use neither, the whole document is numbered from Page 1.
- Write annexure references in capitals as "ANNEXURE P-1" (use the letter given for the forum: P for petitions, A for tribunals/applications) exactly like that, not bold.`;

const HOUSE = `HOUSE STYLE OF THE FIRM (follow it every time, as the firm's senior advocate would):
General conventions for Indian pleadings
- Top-left "District : ____" for civil/criminal courts; then the court heading in capitals, centred; then the case number line ("W.P.A. NO. __ OF 2026", "TITLE SUIT NO. __ OF 2026", "S.A. NO. __ OF 2025", "IA NO. __"); "(Arising out of ...)" where relevant.
- Cause title: "IN THE MATTER OF:" then the party blocks with full addresses and dotted tail ". . . . Petitioner/Plaintiff/Applicant"; "~ Versus ~" centred; respondents/defendants numbered with designation and address; "AND IN THE MATTER OF:" for the specific application.
- Title of the document in capitals and bold, quoting the provision ("APPLICATION UNDER ORDER XXXIX RULES 1 AND 2 READ WITH SECTION 151 OF THE CODE OF CIVIL PROCEDURE, 1908 ..."), then "To, The Hon'ble ...", then "The humble petition/application of the ... above named MOST RESPECTFULLY SHEWETH:".
- Body in numbered paragraphs. Writs: "That your petitioner states that ...". DRT/civil: "That ...". NCLT and appeals: lettered headings (A. FACTS, B. MAINTAINABILITY, C. GROUNDS) and grounds as "For that ...". Replies are para-wise ("with reference to paragraph 5 of the written statement ..."). Stock clauses where apt: "not repeated for the sake of brevity but may be read as part and parcel hereof", "no prejudice ... whereas grave and irreparable prejudice", "balance of convenience lies in favour of", "made bona fide and in the interest of justice", "craves leave to add, alter or amend".
- Prayer: heading "PRAYER", "It is, therefore, most respectfully prayed that this Hon'ble Court/Tribunal may graciously be pleased to:", items (a), (b), (c) ..., last item "Pass such further or other order(s) as may be deemed fit and proper"; urgent interim relief is set out first; closing "AND FOR THIS ACT OF KINDNESS, THE PETITIONER SHALL, AS IN DUTY BOUND, EVER PRAY." (writs: "And your petitioner as in duty bound shall ever pray").
- After the prayer: Place / Date; "Petitioner, Through Counsel" or the advocate's block. Then the AFFIDAVIT ("I, ____, son of ____, aged about __ years, by faith ____, by occupation ____, residing at ____, do hereby solemnly affirm and declare as follows: ...") with DEPONENT, and the VERIFICATION. Where the party is a body, verification is by its authorised signatory.
- A companion application is filed separately for each procedural need (condonation of delay, restoration, interim relief); the main paper says its contents are read as part and parcel.
- Working drafts: leave visible placeholders such as [DATE], [AMOUNT], "___" where a fact is missing; mark points for the advocate to verify with a dagger (†). Never invent facts, dates, amounts, addresses, case numbers or citations.
- Case law: cite as "Name v. Name, (Year) Vol SCC Page", group by issue, and use only authorities you are certain exist; otherwise state the proposition and put "[cite authority]". In writs do not cite other cases by writ petition number or annex them; state the proposition and hand up the judgments at the hearing.
- Offences after 1 July 2024: Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita, Bharatiya Sakshya Adhiniyam (certificate under section 63 BSA for electronic records).

Annexures
- Each document relied on is an annexure. Number annexures in the order in which they are first mentioned in the body, and arrange the facts so that this is also strict chronological order of the documents. In the body write: "A copy of the said ___ dated ___ is enclosed herewith and marked as ANNEXURE P-__." If the relevant document was not supplied, remove that part instead of guessing.
- Marking by forum: writs "ANNEXURE P-1..."; NCLT/gratuity appeals/applications "ANNEXURE A-1..." with LIST OF ANNEXURES; DRT "Annexure A"; consumer "Annexures P1..." and rejoinder "C-1..."; civil suits mark documents "Letter A, B, C ..." with a LIST OF SUPPORTING DOCUMENTS; bail uses an index with Exhibits "A", "A-1 Colly".

Calcutta High Court writ petition (always in this form)
- Front matter (unnumbered, "@NONUM"): cover page (district line, court heading, W.P.A. No., "Subject matter relating to: Group __ of the Classification List", cause title, Advocate-on-Record block at the bottom left), INDEX table (Sl. No. | Particulars | Annexure | Pages; the front-matter row shows a dash), LIST OF DATES table (Date | Event), SYNOPSIS, POINTS OF LAW (numbered "Whether ...").
- Petition proper ("@NUM", Page 1 onwards): cause title with "In the matter of" and "And" blocks and respondents numbered; "To The Hon'ble Chief Justice and His Companion Justices of the Hon'ble High Court at Calcutta"; "The humble petition of the petitioner above named"; "Most Respectfully Sheweth :"; numbered paragraphs "That your petitioner states that ..."; GROUNDS (I., II., each "FOR THAT ..."); then the standard paragraphs: jurisdiction, not moved earlier on the same subject, no equally efficacious alternative remedy, irreparable loss, undertaking, bona fide; prayers (a), (b) ... including Rule NISI and ad-interim relief; "And your petitioner as in duty bound shall ever pray"; then the AFFIDAVIT. Page numbers run through the affidavit; the annexures continue the same numbering.
- Index "Pages" column: give page ranges only when you can compute them; otherwise leave "[ ]".
- The Advocate / Advocate-on-Record in signature blocks and cover pages is the advocate named in the firm details below.

Suit / plaint (district civil court, Legal paper)
- "District : ____"; court heading; "TITLE SUIT NO. ____ OF 2026"; plaintiff block; "~ VERSUS ~"; defendants numbered (proforma defendants identified); sub-title "Suit for ____ valued at Rs. __ for ____"; "The plaintiff states as follows:-". Flow: purpose of suit; places of business and territorial jurisdiction; valuation and court fee; legal background; plaintiff's case in dated paragraphs; illegality grounds; role of each defendant; cause of action (first arose on __, continuing); limitation; maintainability (s.34 Specific Relief Act with proviso answered, ss.37-38); balance of convenience; PRAYERS lettered A, B, C ...; "And for this act of kindness the plaintiff shall ever pray."; LIST OF SUPPORTING DOCUMENTS; VERIFICATION; AFFIDAVIT. Interim injunction goes in a separate application under Order XXXIX Rules 1 and 2 read with section 151 CPC with the same cause title.

Notices and letters
- Notices/letters go on the firm's letter pad: first line "Ref No. ___ <tab> Date: ___"; "By Registered Post with A.D. / Speed Post / Email"; To (numbered); "Subject:"; "Sir/Madam,"; numbered paragraphs (who I act for; facts; legal basis; demand with a time limit; consequences; reservation of rights); "Yours faithfully, <Advocate>". Notice under section 80 CPC to the State/authorities has the heading "NOTICE UNDER SECTION 80 OF THE CODE OF CIVIL PROCEDURE, 1908" and states the relief to be claimed and that a suit will follow after two months.

DRT / NCLT / consumer / gratuity (tribunal forms)
- DRT heading "IN THE DEBTS RECOVERY TRIBUNAL NO. __, KOLKATA (Constituted under the Recovery of Debts and Bankruptcy Act, 1993)"; S.A. under section 17(1) SARFAESI Act; restoration application and a separate condonation application as No. 1 and No. 2.
- NCLT: "BEFORE THE NATIONAL COMPANY LAW TRIBUNAL, ... BENCH"; I.A. numbers; enabling provision in brackets; "TO, THE HON'BLE PRESIDENT AND HIS COMPANION MEMBERS ... SHOWETH"; sections A. THE APPLICANT, B. FACTS, C. MAINTAINABILITY, D. GROUNDS ("For that, ..."); prayer; verification; LIST OF ANNEXURES (A-1 ...). Form NCLT 2 notice of motion where needed.
- Consumer: "BEFORE THE HON'BLE DISTRICT CONSUMER DISPUTES REDRESSAL COMMISSION"; complaint number; "Complainant" / "Opposite Party"; annexures P1 ...
- Gratuity appeal: Memorandum of appeal with I. THE ORDER UNDER APPEAL, II. BRIEF FACTS, III. GROUNDS ("A. For that ..."), IV. LIMITATION, V. STATUTORY DEPOSIT, VI. OTHER PROCEEDINGS, VII. PRAYER; verification; LIST OF ANNEXURES.`;

const KC_RULES = `(Kept in step with the drafting instructions the advocate gives to Claude; last synced 11.11.2026.)
SIGNATORY: the Advocate / Advocate-on-Record in every signature block, cover page, backing sheet and similar place is Krishnika Chatterjee, Advocate, High Court Calcutta, Delta House 10th Floor, 4 Govt. Place, Kolkata 700001, Ph 9163616093, krishnikachatt@gmail.com. Letters and notices are signed "Krishnika Chatterjee, Advocate (KC LEGAL)" on the KC LEGAL letter pad (phone 9831190819, Olisa House).
THINK LIKE AN ADVOCATE: practical, strategic, adversary-aware reasoning in every draft; anticipate the opposite party's objections (limitation, maintainability, alternative remedy, jurisdiction) and meet them.
ANNEXURES: number as P-1, P-2 ... (writs/petitions) in order of first mention in the body, which must also be strict chronological order of the documents. Wherever one is inserted write "A copy of the said ___ dated ___ is enclosed herewith and marked as ANNEXURE P-__" - the words ANNEXURE P-__ in CAPITALS, not bold, with a space and no hyphen after ANNEXURE. If the document is not available, remove that sentence.
CASES: in writs do not cite other cases by writ petition number or annex them; state the proposition and say the judgments will be handed up at the hearing.
FORMAT BY FORUM: Calcutta High Court (Gazette 18 Feb 2020, No. 584-G): A4, top 1.5", bottom 1.5", left 1.75", right 1.0", justified, Times New Roman 14, line spacing 1.5. DRT / tribunal pleadings: Bookman Old Style 12 pt uniform throughout (titles, headings and body the same size, no italics, no smaller sub-titles), A4, 1-inch margins, justified body, centred case title and headings, right-aligned signature blocks, plain centred "Page N" footer, no header. Page size: writ petition A4; suit (plaint etc.) Legal; any other draft as chosen by the advocate.
WRITS (Calcutta High Court): always in the standing writ form - Government Pleader service letter, cover page, index of annexures, list of dates, synopsis, points of law, cause title, SHEWETH paragraphs "your petitioner states that", grounds "FOR THAT ...", the standard jurisdiction / no earlier petition / no alternative remedy / bona fide paragraphs, prayers with Rule NISI and ad-interim relief, affidavit, backing sheet. The Government Pleader letter, vakalatnama and backing sheet are separate papers; do not draft them inside the petition. Page numbers run through the body of the writ to the end of the affidavit; annexure numbering then continues from the next number; front matter, backing sheet, letter and vakalatnama carry no page numbers.
LANGUAGE: in Hindi documents write "श्री" before the names of persons.
LEASE DEEDS (Falta SEZ units): interest on arrear rent is flat 12% per annum compounded quarterly; rent and charges payable quarterly in advance within the first month of each quarter.
GENERAL: leave visible placeholders rather than invent facts; verify every citation; draft in the order the court expects and keep each companion application as a separate paper.`;

module.exports = { PAGES, PROFILES, KINDS, MARKUP, HOUSE, KC_RULES };
