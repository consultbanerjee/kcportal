'use strict';
// v4.0 extras: Repository (curated official links, editable per firm), client consent records (DPDP), follow-up worklist, home dashboard extras.
const L = require('../lib');
const AI = require('../aicore');
const { db, audit } = L;
const OFF = L.need('admin', 'advocate', 'staff', 'telecaller', 'accounts');

// Standard official and free resources. Each firm can hide any of them and add its own.
const CATALOG = [
  ['Courts', [
    ['Supreme Court of India', 'https://www.sci.gov.in/', 'Cause lists, orders, judgments, e-filing links'],
    ['Supreme Court — judgments', 'https://www.sci.gov.in/judgements-judgement-date/', 'Search judgments by date'],
    ['Calcutta High Court', 'https://calcuttahighcourt.gov.in/', 'Cause lists, notices, orders, calendar'],
    ['eCourts Services — case status', 'https://services.ecourts.gov.in/ecourtindia_v6/', 'District and Taluka courts: case status, cause list, orders by CNR'],
    ['High Court Services (eCourts)', 'https://hcservices.ecourts.gov.in/hcservices/', 'Case status and orders of High Courts'],
    ['District Courts (eCourts portal)', 'https://districts.ecourts.gov.in/', 'Pick a state and district'],
    ['National Judicial Data Grid', 'https://njdg.ecourts.gov.in/njdgnew/index.php', 'Pendency and disposal statistics'],
    ['eCourts — online fee payment', 'https://pay.ecourts.gov.in/', 'Court fee and fine payment'],
    ['Supreme Court e-filing', 'https://efiling.sci.gov.in/', 'Register and file in the Supreme Court'],
  ]],
  ['All High Courts', [
    ['Allahabad High Court', 'https://www.allahabadhighcourt.in/', 'Uttar Pradesh'],
    ['Andhra Pradesh High Court', 'https://hc.ap.nic.in/', 'Andhra Pradesh'],
    ['Bombay High Court', 'https://bombayhighcourt.nic.in/', 'Maharashtra, Goa, Dadra & Nagar Haveli, Daman & Diu'],
    ['Calcutta High Court', 'https://calcuttahighcourt.gov.in/', 'West Bengal, Andaman & Nicobar'],
    ['Chhattisgarh High Court', 'https://highcourt.cg.gov.in/', 'Chhattisgarh'],
    ['Delhi High Court', 'https://delhihighcourt.nic.in/', 'Delhi'],
    ['Gauhati High Court', 'https://ghconline.gov.in/', 'Assam, Nagaland, Mizoram, Arunachal Pradesh'],
    ['Gujarat High Court', 'https://gujarathighcourt.nic.in/', 'Gujarat'],
    ['Himachal Pradesh High Court', 'https://hphighcourt.nic.in/', 'Himachal Pradesh'],
    ['High Court of Jammu & Kashmir and Ladakh', 'https://jkhighcourt.nic.in/', 'J&K and Ladakh'],
    ['Jharkhand High Court', 'https://jharkhandhighcourt.nic.in/', 'Jharkhand'],
    ['Karnataka High Court', 'https://karnatakajudiciary.kar.nic.in/', 'Karnataka'],
    ['Kerala High Court', 'https://highcourtofkerala.nic.in/', 'Kerala, Lakshadweep'],
    ['Madhya Pradesh High Court', 'https://mphc.gov.in/', 'Madhya Pradesh'],
    ['Madras High Court', 'https://www.mhc.tn.gov.in/', 'Tamil Nadu, Puducherry'],
    ['Manipur High Court', 'https://hcmimphal.nic.in/', 'Manipur'],
    ['Meghalaya High Court', 'https://meghalayahighcourt.nic.in/', 'Meghalaya'],
    ['Orissa High Court', 'https://orissahighcourt.nic.in/', 'Odisha'],
    ['Patna High Court', 'https://patnahighcourt.gov.in/', 'Bihar'],
    ['Punjab and Haryana High Court', 'https://highcourtchd.gov.in/', 'Punjab, Haryana, Chandigarh'],
    ['Rajasthan High Court', 'https://hcraj.nic.in/', 'Rajasthan'],
    ['Sikkim High Court', 'https://hcs.gov.in/', 'Sikkim'],
    ['Telangana High Court', 'https://tshc.gov.in/', 'Telangana'],
    ['Tripura High Court', 'https://thc.nic.in/', 'Tripura'],
    ['Uttarakhand High Court', 'https://highcourtofuttarakhand.gov.in/', 'Uttarakhand'],
    ['High Courts — judgment search (all)', 'https://judgments.ecourts.gov.in/', 'Free search of judgments and orders of all High Courts'],
  ]],
  ['Tribunals', [
    ['NCLT', 'https://nclt.gov.in/', 'National Company Law Tribunal'],
    ['NCLAT', 'https://nclat.nic.in/', 'National Company Law Appellate Tribunal'],
    ['DRT / DRAT', 'https://drt.gov.in/', 'Debts Recovery Tribunals and Appellate Tribunal'],
    ['Income Tax Appellate Tribunal', 'https://itat.gov.in/', 'ITAT benches, orders, cause lists'],
    ['CESTAT', 'https://cestat.gov.in/', 'Customs, Excise and Service Tax Appellate Tribunal'],
    ['National Green Tribunal', 'https://greentribunal.gov.in/', 'Environment matters'],
    ['Securities Appellate Tribunal', 'https://sat.gov.in/', 'SEBI appeals'],
    ['TDSAT', 'https://tdsat.gov.in/', 'Telecom disputes'],
    ['Central Administrative Tribunal', 'https://cgat.gov.in/', 'Service matters of Central Government employees'],
    ['NCDRC', 'https://ncdrc.nic.in/', 'National Consumer Disputes Redressal Commission'],
    ['APTEL', 'https://aptel.gov.in/', 'Appellate Tribunal for Electricity'],
    ['Central Government Industrial Tribunals (CGIT-cum-Labour Courts)', 'https://cgit.labour.gov.in/', 'Industrial disputes in the Central sphere, EPF appeals, cause lists, awards (22 benches, incl. Kolkata and Asansol)'],
    ['West Bengal Industrial Tribunals and Labour Courts', 'https://labour.wb.gov.in/node/101', 'State Industrial Tribunals and Labour Courts: functions and benches'],
    ['West Bengal Labour Department — awards', 'https://labour.wb.gov.in/', 'Published awards of Industrial Tribunals, notifications, Labour Directorates'],
    ['Labour Courts — case status (eCourts)', 'https://services.ecourts.gov.in/ecourtindia_v6/', 'Where a Labour Court is on eCourts, use Case Status'],
    ['West Bengal Administrative Tribunal', 'https://wbat.gov.in/', 'Service matters of State Government employees'],
    ['West Bengal Real Estate Appellate Tribunal (WBREAT)', 'https://rera.wb.gov.in/wbreat/', 'Appeals from WBRERA and Adjudicating Officer'],
    ['Armed Forces Tribunal', 'https://aftdelhi.nic.in/', 'Service and pension matters of armed forces personnel'],
    ['Railway Claims Tribunal', 'https://rct.indianrailways.gov.in/', 'Railway accident and freight claims'],
  ]],
  ['Forums (consumer, ADR and grievance)', [
    ['e-Daakhil — file a consumer case online', 'https://edaakhil.nic.in/', 'District, State and National Consumer Commissions'],
    ['CONFONET — consumer case status', 'https://confonet.nic.in/', 'Case status, cause lists, judgments of Consumer Commissions'],
    ['District Consumer Commissions (West Bengal)', 'https://wbconsumers.gov.in/', 'West Bengal Consumer Affairs Department: district forums and addresses'],
    ['West Bengal State Consumer Disputes Redressal Commission', 'https://wbconsumers.gov.in/HtmlPages/con_StateCommisionpage.aspx', 'State Commission, Kolkata and Siliguri benches'],
    ['NCDRC (National Commission)', 'https://ncdrc.nic.in/', 'National Consumer Disputes Redressal Commission'],
    ['National Consumer Helpline', 'https://consumerhelpline.gov.in/', 'Pre-litigation consumer complaints (1915)'],
    ['NALSA — free legal aid, Lok Adalats', 'https://nalsa.gov.in/', 'National Legal Services Authority: legal aid, Lok Adalat, mediation'],
    ['West Bengal State Legal Services Authority (Lok Adalat, legal aid, mediation)', 'https://westbengal.nalsa.gov.in/', 'WBSLSA: Lok Adalat dates, free legal aid, panel lawyers, victim compensation, DLSA contacts'],
    ['District Legal Services Authorities — West Bengal', 'https://nalsa.gov.in/dashboard/WB', 'List of DLSAs in the State and their Lok Adalat activity'],
    ['Virtual Courts — traffic challans and petty cases', 'https://vcourts.gov.in/', 'Pay or contest court-referred traffic challans online'],
    ['RBI Complaint Management System', 'https://cms.rbi.org.in/', 'Banking, NBFC and payment complaints (RBI Ombudsman)'],
    ['Insurance Ombudsman', 'https://www.cioins.co.in/', 'Insurance complaints'],
    ['IRDAI Bima Bharosa', 'https://bimabharosa.irdai.gov.in/', 'Insurance grievance portal'],
    ['SEBI SCORES', 'https://scores.sebi.gov.in/', 'Investor complaints against listed companies and intermediaries'],
    ['CPGRAMS — public grievances', 'https://pgportal.gov.in/', 'Central and State Government grievance portal'],
    ['Mumbai Centre for International Arbitration', 'https://mcia.org.in/', 'Institutional arbitration in India'],
    ['Delhi International Arbitration Centre', 'https://dhcdiac.nic.in/', 'Arbitration and mediation under Delhi High Court'],
    ['Indian Council of Arbitration', 'https://www.icaindia.co.in/', 'Institutional arbitration'],
    ['TRAI — telecom consumer', 'https://www.trai.gov.in/', 'Telecom regulator and consumer information'],
  ]],
  ['Authorities and commissions', [
    ['Chief Labour Commissioner (Central)', 'https://clc.gov.in/clc/', 'Central industrial relations machinery; Controlling Authority and Appellate Authority under Payment of Gratuity Act (Central sphere)'],
    ['Ministry of Labour and Employment — CACLB and Acts', 'https://labour.gov.in/', 'Central Advisory Contract Labour Board (CACLB), labour laws and codes'],
    ['West Bengal Labour Commissionerate', 'https://labour.wb.gov.in/', 'Labour Commissioner, Controlling Authorities under Gratuity Act, Registrar of Trade Unions, State Advisory Contract Labour Board'],
    ['Shram Suvidha portal', 'https://shramsuvidha.gov.in/', 'Labour registrations, returns and inspections'],
    ['EPFO', 'https://www.epfindia.gov.in/', 'Provident fund, pension; Regional PF Commissioner'],
    ['ESIC', 'https://www.esic.gov.in/', 'Employees State Insurance'],
    ['Competition Commission of India', 'https://www.cci.gov.in/', 'Competition law'],
    ['SEBI', 'https://www.sebi.gov.in/', 'Securities regulator'],
    ['Reserve Bank of India', 'https://www.rbi.org.in/', 'Banking regulator; master directions and circulars'],
    ['IRDAI', 'https://irdai.gov.in/', 'Insurance regulator'],
    ['PFRDA', 'https://www.pfrda.org.in/', 'Pension regulator'],
    ['IBBI', 'https://ibbi.gov.in/', 'Insolvency and Bankruptcy Board of India'],
    ['IP India (patents, trade marks, designs)', 'https://ipindia.gov.in/', 'Intellectual property offices'],
    ['West Bengal Real Estate Regulatory Authority (WBRERA)', 'https://rera.wb.gov.in/', 'Project registration, complaints, orders'],
    ['West Bengal Pollution Control Board', 'https://www.wbpcb.gov.in/', 'Consents and environmental compliance'],
    ['Central Pollution Control Board', 'https://cpcb.nic.in/', 'National pollution regulator'],
    ['FSSAI', 'https://fssai.gov.in/', 'Food safety licences and regulation'],
    ['Central Information Commission', 'https://cic.gov.in/', 'RTI second appeals and complaints'],
    ['Central Vigilance Commission', 'https://cvc.gov.in/', 'Vigilance and anti-corruption'],
    ['Lokpal of India', 'https://lokpal.gov.in/', 'Anti-corruption ombudsman'],
    ['National Human Rights Commission', 'https://nhrc.nic.in/', 'Human rights complaints'],
    ['National Commission for Scheduled Castes (NCSC)', 'https://ncsc.nic.in/', 'Complaints on atrocities, service and reservation safeguards for SCs'],
    ['National Commission for Scheduled Tribes (NCST)', 'https://ncst.nic.in/', 'Complaints and safeguards for STs; complaint status'],
    ['National Commission for Backward Classes (NCBC)', 'https://ncbc.nic.in/', 'OBC inclusion and grievances'],
    ['National Commission for Minorities', 'https://ncm.nic.in/', 'Minority rights and complaints'],
    ['West Bengal Commission for Backward Classes', 'https://wbcbc.gov.in/', 'State OBC list, advices, forms'],
    ['West Bengal Backward Classes Welfare Department', 'https://anagrasarkalyan.gov.in/', 'SC/ST/OBC welfare, caste certificate rules, POA Act implementation'],
    ['National Commission for Women', 'https://ncw.nic.in/', 'Complaints on women\'s rights'],
    ['National Commission for Protection of Child Rights', 'https://ncpcr.gov.in/', 'Child rights'],
    ['Election Commission of India', 'https://eci.gov.in/', 'Elections and electoral rolls'],
    ['West Bengal State Election Commission', 'https://wbsec.gov.in/', 'Panchayat and municipal elections'],
    ['Enforcement Directorate', 'https://enforcementdirectorate.gov.in/', 'FEMA and PMLA'],
    ['Central Bureau of Investigation', 'https://cbi.gov.in/', 'Investigation agency'],
  ]],
  ['Parliament and Legislatures', [
    ['Sansad (Parliament of India)', 'https://sansad.in/', 'Debates, bills, questions'],
    ['Lok Sabha', 'https://loksabha.nic.in/', 'House of the People: members, bills, debates'],
    ['Rajya Sabha', 'https://rajyasabha.nic.in/', 'Council of States'],
    ['Parliament Library (ePARLIB)', 'https://eparlib.nic.in/', 'Debates, committee reports, Acts of Parliament'],
    ['West Bengal Legislative Assembly (Vidhan Sabha)', 'https://wbassembly.gov.in/', 'Bulletins, questions, list of business, MLAs'],
    ['NeVA — National e-Vidhan Application', 'https://neva.gov.in/', 'Digital proceedings of State Legislatures (Vidhan Sabhas)'],
    ['PRS — State legislatures', 'https://prsindia.org/legislatures/states', 'Sessions and bills of every State Assembly'],
    ['Legislative Department', 'https://legislative.gov.in/', 'Acts, Constitution, rules, bills'],
  ]],
  ['International courts with a link to India', [
    ['International Court of Justice (ICJ)', 'https://www.icj-cij.org/', 'India accepts its compulsory jurisdiction with reservations (e.g. Commonwealth disputes)'],
    ['Permanent Court of Arbitration (PCA)', 'https://pca-cpa.org/', 'India is a party to the Hague Conventions; state and investment arbitrations'],
    ['International Tribunal for the Law of the Sea (ITLOS)', 'https://www.itlos.org/', 'India is a party to UNCLOS'],
    ['WTO Dispute Settlement', 'https://www.wto.org/english/tratop_e/dispu_e/dispu_e.htm', 'India is a WTO member; trade disputes'],
    ['UN Human Rights Treaty Bodies', 'https://www.ohchr.org/en/treaty-bodies', 'India reports under ICCPR, ICESCR, CEDAW, CRC etc. (no individual petitions against India)'],
    ['International Labour Organization — supervisory bodies', 'https://www.ilo.org/', 'India is an ILO member; complaints and committee on application of standards'],
  ]],
  ['International courts and bodies (no jurisdiction over India)', [
    ['International Criminal Court (ICC)', 'https://www.icc-cpi.int/', 'India is not a party to the Rome Statute'],
    ['ICSID (World Bank)', 'https://icsid.worldbank.org/', 'India has not joined the ICSID Convention'],
    ['European Court of Human Rights', 'https://www.echr.coe.int/', 'Council of Europe states only'],
    ['Court of Justice of the European Union', 'https://curia.europa.eu/', 'EU law'],
    ['Inter-American Court of Human Rights', 'https://www.corteidh.or.cr/', 'Americas'],
    ['African Court on Human and Peoples\' Rights', 'https://www.african-court.org/', 'African Union states'],
    ['UK Supreme Court', 'https://www.supremecourt.uk/', 'Persuasive authority; decisions free to read'],
    ['Supreme Court of the United States', 'https://www.supremecourt.gov/', 'Persuasive authority'],
    ['ICC International Court of Arbitration', 'https://iccwbo.org/dispute-resolution/', 'Used by contract choice, often in India-linked contracts'],
    ['Singapore International Arbitration Centre (SIAC)', 'https://siac.org.sg/', 'Common seat in India-linked contracts'],
    ['London Court of International Arbitration (LCIA)', 'https://www.lcia.org/', 'Common seat in India-linked contracts'],
    ['Hong Kong International Arbitration Centre', 'https://www.hkiac.org/', 'Arbitration by contract choice'],
  ]],
  ['eLibrary & Research', [
    ['Indian Kanoon', 'https://indiankanoon.org/', 'Free search of judgments and statutes'],
    ['India Code', 'https://www.indiacode.nic.in/', 'Central and State Acts, official text'],
    ['Legislative Department', 'https://legislative.gov.in/', 'Acts, Constitution, rules, bills'],
    ['eGazette of India', 'https://egazette.gov.in/', 'Official gazette notifications'],
    ['Law Commission of India', 'https://lawcommissionofindia.nic.in/', 'Reports of the Law Commission'],
    ['PRS Legislative Research', 'https://prsindia.org/', 'Bills, Acts, committee reports in plain language'],
    ['Sansad (Parliament of India)', 'https://sansad.in/', 'Debates, bills, questions'],
    ['Digital Sansad / Constitution', 'https://legislative.gov.in/constitution-of-india/', 'Constitution of India'],
    ['Digital Supreme Court Reports (SCR)', 'https://digiscr.sci.gov.in/', 'Free official Supreme Court Reports'],
    ['High Court judgment search (eCourts)', 'https://judgments.ecourts.gov.in/', 'Free judgments and orders of all High Courts'],
    ['CaseMine', 'https://www.casemine.com/', 'Free case-law search (basic use)'],
    ['BAILII', 'https://www.bailii.org/', 'UK and Irish judgments, free'],
    ['CommonLII', 'https://www.commonlii.org/', 'Commonwealth law, free'],
    ['WorldLII', 'https://www.worldlii.org/', 'Law of the world, free'],
    ['Cornell Legal Information Institute', 'https://www.law.cornell.edu/', 'US law and international materials, free'],
    ['Law Library of Congress', 'https://www.loc.gov/law/', 'Free guides to foreign and international law'],
    ['SSRN — law papers', 'https://www.ssrn.com/', 'Free law research papers'],
    ['DOAJ — open access journals', 'https://doaj.org/', 'Free peer-reviewed journals, including law'],
    ['Internet Archive', 'https://archive.org/', 'Free books, old law reports, texts'],
    ['Open Library', 'https://openlibrary.org/', 'Borrow books free'],
    ['Project Gutenberg', 'https://www.gutenberg.org/', 'Free classic books'],
    ['National Digital Library of India', 'https://ndl.iitkgp.ac.in/', 'Free books and journals, including law'],
    ['Shodhganga', 'https://shodhganga.inflibnet.ac.in/', 'Indian theses, including law'],
  ]],
  ['Government repositories (public)', [
    ['India Code', 'https://www.indiacode.nic.in/', 'Central and State Acts'],
    ['eGazette of India', 'https://egazette.gov.in/', 'Gazette notifications'],
    ['Ministry of Law and Justice', 'https://lawmin.gov.in/', 'Legislative, Legal Affairs and Justice departments'],
    ['Department of Justice', 'https://doj.gov.in/', 'Judicial administration, eCourts, Tele-Law'],
    ['Open Government Data (data.gov.in)', 'https://data.gov.in/', 'Public datasets'],
    ['India.gov.in — national portal', 'https://www.india.gov.in/', 'Directory of Government websites'],
    ['National Archives of India', 'https://www.nationalarchives.gov.in/', 'Records, gazettes'],
    ['Abhilekh Patal', 'https://abhilekh-patal.in/', 'Digitised archival records'],
    ['Parliament Library (ePARLIB)', 'https://eparlib.nic.in/', 'Debates, committee reports'],
    ['Census of India', 'https://censusindia.gov.in/', 'Population and household data'],
    ['MyGov', 'https://www.mygov.in/', 'Government consultations and notices'],
    ['Tele-Law', 'https://www.tele-law.in/', 'Free legal advice for eligible citizens'],
  ]],
  ['Newspapers — world (free to read)', [
    ['BBC News', 'https://www.bbc.com/news', 'UK, world news'],
    ['Reuters', 'https://www.reuters.com/', 'World news agency'],
    ['Associated Press', 'https://apnews.com/', 'World news agency'],
    ['Al Jazeera English', 'https://www.aljazeera.com/', 'World news'],
    ['The Guardian', 'https://www.theguardian.com/', 'UK, world news'],
    ['NPR', 'https://www.npr.org/', 'US public radio news'],
    ['Deutsche Welle', 'https://www.dw.com/en/', 'German international broadcaster'],
    ['France 24', 'https://www.france24.com/en/', 'French international news'],
    ['CNN', 'https://edition.cnn.com/', 'World news'],
    ['NHK World-Japan', 'https://www3.nhk.or.jp/nhkworld/', 'Japanese international news'],
  ]],
  ['Newspapers — India', [
    ['The Hindu', 'https://www.thehindu.com/', 'National daily'],
    ['The Times of India', 'https://timesofindia.indiatimes.com/', 'National daily'],
    ['Hindustan Times', 'https://www.hindustantimes.com/', 'National daily'],
    ['The Indian Express', 'https://indianexpress.com/', 'National daily'],
    ['NDTV', 'https://www.ndtv.com/', 'News channel and website'],
    ['The Telegraph (Kolkata)', 'https://www.telegraphindia.com/', 'Kolkata daily'],
    ['Anandabazar Patrika', 'https://www.anandabazar.com/', 'Bengali daily'],
    ['The Statesman', 'https://www.thestatesman.com/', 'Kolkata daily'],
    ['The Economic Times', 'https://economictimes.indiatimes.com/', 'Business daily'],
    ['ThePrint', 'https://theprint.in/', 'Online news and analysis'],
  ]],
  ['News and legal updates', [
    ['LiveLaw', 'https://www.livelaw.in/', 'Court and legal news'],
    ['Bar & Bench', 'https://www.barandbench.com/', 'Court and legal news'],
    ['Verdictum', 'https://www.verdictum.in/', 'Judgment reports'],
    ['SCC Online Blog', 'https://www.scconline.com/blog/', 'Case notes and updates'],
    ['PIB', 'https://pib.gov.in/', 'Press Information Bureau releases'],
    ['All India Radio News', 'https://newsonair.gov.in/', 'National news'],
    ['DD News', 'https://ddnews.gov.in/', 'National news'],
  ]],
  ['Central Government Services', [
    ['MCA21', 'https://www.mca.gov.in/', 'Company filings and master data'],
    ['Income Tax portal', 'https://www.incometax.gov.in/', 'Returns, e-proceedings, notices'],
    ['GST portal', 'https://www.gst.gov.in/', 'Registration, returns, notices'],
    ['TRACES (TDS)', 'https://www.tdscpc.gov.in/', 'TDS statements and certificates'],
    ['DigiLocker', 'https://www.digilocker.gov.in/', 'Verified government documents'],
    ['UMANG', 'https://web.umang.gov.in/', 'Many central and state services in one place'],
    ['SHCIL e-Stamping', 'https://www.shcilestamp.com/', 'Online stamp duty'],
    ['Passport Seva', 'https://www.passportindia.gov.in/', 'Passport services'],
    ['UIDAI (Aadhaar)', 'https://uidai.gov.in/', 'Aadhaar services'],
    ['Parivahan', 'https://parivahan.gov.in/', 'Vehicle and licence records'],
    ['e-Challan — check and pay traffic challans', 'https://echallan.parivahan.gov.in/', 'RTO / traffic police challans of any State by vehicle, licence or challan number'],
    ['Virtual Courts — challans sent to court', 'https://vcourts.gov.in/', 'Pay or contest traffic challans referred to court'],
    ['RTI Online', 'https://rtionline.gov.in/', 'File RTI applications to central bodies'],
    ['Bharatkosh', 'https://bharatkosh.gov.in/', 'Pay government dues online'],
    ['GeM — Government e-Marketplace', 'https://gem.gov.in/', 'Public procurement'],
    ['EPFO member portal', 'https://unifiedportal-mem.epfindia.gov.in/memberinterface/', 'UAN, claims, passbook'],
    ['Udyam Registration', 'https://udyamregistration.gov.in/', 'MSME registration'],
    ['ICEGATE', 'https://www.icegate.gov.in/', 'Customs e-filing'],
    ['IP India online filing', 'https://ipindiaonline.gov.in/', 'Trade mark, patent, design filing and search'],
    ['National Voters\' Service Portal', 'https://voters.eci.gov.in/', 'Electoral roll services'],
    ['National Cyber Crime Reporting Portal', 'https://cybercrime.gov.in/', 'Report cyber crime'],
    ['Startup India', 'https://www.startupindia.gov.in/', 'Recognition and schemes'],
  ]],
  ['West Bengal Government Services', [
    ['West Bengal Government (wb.gov.in)', 'https://wb.gov.in/', 'State portal, departments, Acts & Rules'],
    ['Aponbangla — citizen services', 'https://aponbangla.wb.gov.in/', 'State e-governance citizen services'],
    ['e-District West Bengal', 'https://edistrict.wb.gov.in/', 'Certificates, licences and district services'],
    ['Banglar Bhumi', 'https://banglarbhumi.gov.in/', 'West Bengal land records'],
    ['WB Registration (IGR)', 'https://wbregistration.gov.in/', 'Deed registration, encumbrance, valuation'],
    ['WB Commercial Taxes', 'https://wbcomtax.nic.in/', 'State GST, professional tax, VAT'],
    ['WB Finance — GRIPS e-receipt', 'https://www.wbifms.gov.in/', 'Pay State Government dues'],
    ['WB Labour Department', 'https://labour.wb.gov.in/', 'Labour laws, tribunals, welfare boards'],
    ['WB Social Security portal', 'https://socialsecurity.wb.gov.in/', 'Unorganised workers\' schemes'],
    ['WB Excise Department', 'https://excise.wb.gov.in/', 'Licences and duty'],
    ['WB Caste Certificate portal', 'https://castecertificatewb.gov.in/', 'SC/ST/OBC certificates'],
    ['WB Housing Department', 'https://housing.wb.gov.in/', 'Housing, WBRERA scheme, apartment ownership'],
    ['WB Consumer Affairs', 'https://wbconsumers.gov.in/', 'Consumer commissions and Legal Metrology'],
    ['West Bengal Police', 'https://wbpolice.gov.in/', 'Citizen services, e-FIR, clearance certificate'],
    ['Kolkata Police', 'https://www.kolkatapolice.gov.in/', 'Citizen services, verification, licences'],
    ['Kolkata Municipal Corporation', 'https://www.kmcgov.in/', 'Building plans, assessment, trade licence'],
    ['WBSEDCL', 'https://www.wbsedcl.in/', 'Electricity connection and bills'],
    ['West Bengal Legislative Assembly', 'https://wbassembly.gov.in/', 'Bulletins, questions, MLAs'],
  ]],
  ['Professional bodies', [
    ['Bar Council of India', 'https://www.barcouncilofindia.org/', 'Rules, notices, enrolment'],
    ['National Law School of India University', 'https://www.nls.ac.in/', 'Legal education and research'],
    ['WB National University of Juridical Sciences', 'https://www.nujs.edu/', 'Kolkata law university'],
  ]],
];

// v4.3: categories were renamed/split; carry over any firm customisations.
try {
  db.prepare("UPDATE repo_links SET cat='eLibrary & Research' WHERE cat='Free eLibrary and research'").run();
  db.prepare("UPDATE repo_links SET cat='Central Government Services' WHERE cat='Government services'").run();
  db.prepare("UPDATE OR IGNORE repo_hide SET key=replace(key,'Free eLibrary and research|','eLibrary & Research|') WHERE key LIKE 'Free eLibrary and research|%'").run();
  const WBH = /banglarbhumi|wb\.gov\.in|kmcgov/;
  for (const r of db.prepare("SELECT tenant_id,key FROM repo_hide WHERE key LIKE 'Government services|%'").all()) {
    const url = r.key.slice('Government services|'.length);
    db.prepare('UPDATE OR IGNORE repo_hide SET key=? WHERE tenant_id=? AND key=?').run((WBH.test(url) ? 'West Bengal Government Services|' : 'Central Government Services|') + url, r.tenant_id, r.key);
  }
} catch (e) { /* tables not ready on a brand-new install; nothing to carry over */ }

// ---- Weekly link check: finds dead links, follows permanent redirects, shows the result in Repository ----
db.exec('CREATE TABLE IF NOT EXISTS repo_status (url TEXT PRIMARY KEY, status TEXT, code INTEGER, fails INTEGER DEFAULT 0, new_url TEXT, checked_at TEXT)');
const BOT_OK = new Set([401, 403, 405, 406, 429, 451, 999]); // sites that refuse automatic visitors but are alive
const strip = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search; } catch (e) { return u; } };
async function probe(url) {
  let cur = url, permanent = true;
  for (let hop = 0; hop < 6; hop++) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
    let r;
    try { r = await fetch(cur, { method: 'GET', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; KCPortalLinkCheck/1.0)', accept: 'text/html,*/*' } }); }
    catch (e) { clearTimeout(tm); return { status: 'down', code: 0 }; }
    clearTimeout(tm); try { if (r.body) r.body.cancel(); } catch (e) { /* ignore */ }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location'); if (!loc) return { status: 'down', code: r.status };
      if (![301, 308].includes(r.status)) permanent = false;
      cur = new URL(loc, cur).toString(); continue;
    }
    if (BOT_OK.has(r.status)) return { status: 'ok', code: r.status };
    if (r.status >= 200 && r.status < 300) {
      const moved = permanent && cur !== url && strip(cur) !== strip(url) && /^https:\/\//.test(cur) && !(new URL(url).pathname.length > 1 && new URL(cur).pathname === '/');
      return { status: 'ok', code: r.status, new_url: moved ? cur : null };
    }
    return { status: 'down', code: r.status };
  }
  return { status: 'down', code: 310 };
}
let running = false;
async function checkAll() {
  if (running) return { skipped: true }; running = true;
  const t0 = new Date().toISOString();
  try {
    const urls = [...new Set([...CATALOG.flatMap(([, l]) => l.map((x) => x[1])), ...db.prepare('SELECT DISTINCT url FROM repo_links').all().map((r) => r.url)])];
    let i = 0;
    const one = async () => {
      while (i < urls.length) {
        const u = urls[i++]; let r; try { r = await probe(u); } catch (e) { r = { status: 'down', code: 0 }; }
        const old = db.prepare('SELECT fails FROM repo_status WHERE url=?').get(u);
        const fails = r.status === 'down' ? ((old && old.fails) || 0) + 1 : 0;
        db.prepare('INSERT INTO repo_status(url,status,code,fails,new_url,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET status=excluded.status, code=excluded.code, fails=excluded.fails, new_url=excluded.new_url, checked_at=excluded.checked_at')
          .run(u, r.status, r.code, fails, r.new_url || null, new Date().toISOString());
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    AI.setS(0, 'repo_last_run', t0);
    return { checked: urls.length };
  } finally { running = false; }
}
const WEEK = 7 * 86400000;
const startWorker = () => {
  const tick = () => { const last = AI.getS(0, 'repo_last_run', ''); if (!last || Date.now() - Date.parse(last) >= WEEK) checkAll().catch((e) => console.error('repo check', e.message)); };
  const first = setTimeout(tick, 3 * 60 * 1000), t = setInterval(tick, 60 * 60 * 1000); first.unref && first.unref(); t.unref && t.unref();
};
const keyOf = (cat, url) => cat + '|' + url;

const CONSENT_PURPOSES = ['Handling my case papers and personal data', 'Contacting me by WhatsApp / SMS', 'Contacting me by email', 'Birthday and festival greetings', 'Sharing documents through the client portal'];
const todayStr = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const okUrl = (u) => /^https?:\/\/[^\s<>"']+$/i.test(u) && u.length < 400;

module.exports = (app) => {
  const T = (req) => req.user.tenant_id;

  // ---- Repository ----
  app.get('/api/repository', L.requireLogin, (req, res) => {
    if (req.user.role === 'client' || req.user.role === 'superadmin') return res.status(403).json({ error: 'Not available.' });
    const t = T(req), hide = new Set(db.prepare('SELECT key FROM repo_hide WHERE tenant_id=?').all(t).map((r) => r.key));
    const st = new Map(db.prepare('SELECT * FROM repo_status').all().map((r) => [r.url, r]));
    const fx = (url) => { const r = st.get(url); return { url: r && r.new_url ? r.new_url : url, down: !!(r && r.status === 'down' && r.fails >= 2), moved: !!(r && r.new_url) }; };
    const cats = CATALOG.map(([cat, list]) => ({ cat, links: list.map(([title, url, note]) => ({ title, note, std: true, hidden: hide.has(keyOf(cat, url)), key: keyOf(cat, url), ...fx(url) })) }));
    for (const r of db.prepare('SELECT * FROM repo_links WHERE tenant_id=? ORDER BY id').all(t)) {
      let c = cats.find((x) => x.cat === r.cat); if (!c) { c = { cat: r.cat, links: [] }; cats.push(c); }
      c.links.push({ id: r.id, title: r.title, note: r.note, std: false, hidden: false, ...fx(r.url) });
    }
    res.json(cats);
  });
  app.get('/api/repository/status', L.requireLogin, (req, res) => {
    if (req.user.role === 'client') return res.status(403).json({ error: 'Not available.' });
    const rows = db.prepare('SELECT url,status,fails,new_url FROM repo_status').all();
    res.json({ last_run: AI.getS(0, 'repo_last_run', ''), running, checked: rows.length, down: rows.filter((r) => r.status === 'down' && r.fails >= 2).length, moved: rows.filter((r) => r.new_url).length });
  });
  app.post('/api/repository/check', L.need('admin', 'superadmin'), (req, res) => {
    if (running) return res.json({ started: false, message: 'A check is already running.' });
    checkAll().catch((e) => console.error('repo check', e.message));
    res.json({ started: true, message: 'Checking started. It takes a few minutes; refresh this page later.' });
  });
  app.post('/api/repository', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const cat = L.str(req.body.cat, 60), title = L.str(req.body.title, 120), url = L.str(req.body.url, 400), note = L.str(req.body.note, 200);
    if (!L.must(res, cat && title && okUrl(url), 'Enter a category, a title and a full web address starting with https://')) return;
    res.json({ id: db.prepare('INSERT INTO repo_links(tenant_id,cat,title,url,note) VALUES (?,?,?,?,?)').run(T(req), cat, title, url, note).lastInsertRowid });
  });
  app.delete('/api/repository/:id', L.need('admin', 'advocate', 'staff'), (req, res) => { db.prepare('DELETE FROM repo_links WHERE id=? AND tenant_id=?').run(req.params.id, T(req)); res.json({ ok: true }); });
  app.post('/api/repository/hide', L.need('admin'), (req, res) => {
    const key = L.str(req.body.key, 500); if (!L.must(res, CATALOG.some(([c, l]) => l.some((x) => keyOf(c, x[1]) === key)), 'Unknown link.')) return;
    if (req.body.hidden) db.prepare('INSERT OR IGNORE INTO repo_hide(tenant_id,key) VALUES (?,?)').run(T(req), key); else db.prepare('DELETE FROM repo_hide WHERE tenant_id=? AND key=?').run(T(req), key);
    res.json({ ok: true });
  });

  // ---- client consent records ----
  app.get('/api/consents', OFF, (req, res) => {
    const t = T(req);
    const rows = db.prepare('SELECT k.*, c.name client FROM client_consents k JOIN clients c ON c.id=k.client_id WHERE k.tenant_id=? ORDER BY k.id DESC LIMIT 500').all(t);
    const without = db.prepare("SELECT COUNT(*) n FROM clients WHERE tenant_id=? AND id NOT IN (SELECT client_id FROM client_consents WHERE tenant_id=? AND withdrawn_on IS NULL)").get(t, t).n;
    res.json({ rows, without, purposes: CONSENT_PURPOSES, notice: AI.getS(t, 'consent_notice', '') });
  });
  app.post('/api/consents', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const c = db.prepare('SELECT id,name FROM clients WHERE id=? AND tenant_id=?').get(L.int(req.body.client_id), T(req));
    const purposes = (Array.isArray(req.body.purposes) ? req.body.purposes : [req.body.purpose]).map((x) => L.str(x, 120)).filter(Boolean);
    const mode = ['written', 'verbal', 'portal', 'email'].includes(req.body.mode) ? req.body.mode : 'written';
    if (!L.must(res, c && purposes.length, 'Choose a client and at least one purpose.')) return;
    const on = L.isDate(req.body.given_on) ? req.body.given_on : todayStr(), ins = db.prepare('INSERT INTO client_consents(tenant_id,client_id,purpose,mode,given_on,note,created_by) VALUES (?,?,?,?,?,?,?)');
    db.transaction(() => purposes.forEach((p) => ins.run(T(req), c.id, p, mode, on, L.str(req.body.note, 300), req.user.id)))();
    audit(T(req), req.user.id, 'consent_recorded', 'client', c.id, c.name, L.ip(req)); res.json({ ok: true });
  });
  app.post('/api/consents/:id/withdraw', L.need('admin', 'advocate', 'staff'), (req, res) => {
    const r = db.prepare('UPDATE client_consents SET withdrawn_on=? WHERE id=? AND tenant_id=? AND withdrawn_on IS NULL').run(L.isDate((req.body || {}).on) ? req.body.on : todayStr(), req.params.id, T(req));
    if (!r.changes) return res.status(404).json({ error: 'Not found.' });
    // a withdrawn consent for messages stops automatic reminders and greetings for that client
    const k = db.prepare('SELECT * FROM client_consents WHERE id=?').get(req.params.id);
    if (/WhatsApp|SMS/i.test(k.purpose)) db.prepare('UPDATE clients SET wa_optout=1 WHERE id=? AND tenant_id=?').run(k.client_id, T(req));
    if (/greeting/i.test(k.purpose)) db.prepare('UPDATE cal_birthdays SET active=0 WHERE client_id=? AND tenant_id=?').run(k.client_id, T(req));
    audit(T(req), req.user.id, 'consent_withdrawn', 'client', k.client_id, k.purpose, L.ip(req)); res.json({ ok: true });
  });
  app.put('/api/consents/notice', L.need('admin'), (req, res) => { AI.setS(T(req), 'consent_notice', L.str(req.body.notice, 3000)); res.json({ ok: true }); });

  // ---- follow-up worklist: everything that is waiting for someone ----
  app.get('/api/followups', OFF, (req, res) => {
    const t = T(req), today = todayStr(), mine = req.user.role === 'advocate' || req.user.role === 'staff' || req.user.role === 'telecaller';
    const A = mine ? ' AND (assigned_to=? OR assigned_to IS NULL)' : '', a = mine ? [req.user.id] : [];
    const leads = db.prepare(`SELECT id,name,phone,stage,callback_at,issue,created_at FROM leads WHERE tenant_id=? AND stage NOT IN ('converted','lost') ${A}
      AND (callback_at IS NOT NULL AND substr(callback_at,1,10)<=date(?,'+3 day') OR (callback_at IS NULL AND stage='new' AND created_at<datetime('now','-1 day'))) ORDER BY COALESCE(callback_at,created_at) LIMIT 60`).all(t, ...a, today)
      .map((x) => ({ ...x, due: x.callback_at ? x.callback_at.slice(0, 10) : x.created_at.slice(0, 10), why: x.callback_at ? 'Call back' : 'New lead, not yet contacted', overdue: (x.callback_at ? x.callback_at.slice(0, 10) : '9999') < today }));
    const tickets = db.prepare(`SELECT id,subject,name,phone,priority,created_at FROM tickets WHERE tenant_id=? AND status='open' AND created_at<datetime('now','-2 day') ORDER BY created_at LIMIT 40`).all(t);
    const nodate = db.prepare(`SELECT m.id,m.file_no,m.title,m.forum FROM matters m WHERE m.tenant_id=? AND m.status='open' AND NOT EXISTS (SELECT 1 FROM hearings h WHERE h.matter_id=m.id AND h.next_date>=?) ORDER BY m.id DESC LIMIT 40`).all(t, today);
    const dues = db.prepare(`SELECT c.id,c.name,c.phone, SUM(i.total_paise) - COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.client_id=c.id),0) due FROM invoices i JOIN clients c ON c.id=i.client_id
      WHERE i.tenant_id=? AND i.status NOT IN ('draft','cancelled') AND i.inv_date<date(?,'-30 day') GROUP BY c.id HAVING due>0 ORDER BY due DESC LIMIT 40`).all(t, today);
    const tasks = db.prepare(`SELECT id,title,due_date FROM tasks WHERE tenant_id=? AND status<>'done' AND due_date IS NOT NULL AND due_date<=date(?,'+2 day') ${A} ORDER BY due_date LIMIT 40`).all(t, today, ...a);
    const stages = db.prepare('SELECT stage, COUNT(*) n FROM leads WHERE tenant_id=? GROUP BY stage').all(t);
    res.json({ today, leads, tickets, nodate, dues, tasks, stages });
  });

  // ---- extras for the Home page ----
  app.get('/api/home-extra', L.need('admin', 'advocate', 'staff', 'accounts', 'telecaller'), (req, res) => {
    const t = T(req), out = {}, off = AI.getS(t, 'sa_off', '').split(',');
    if (!off.includes('accounts') && ['admin', 'advocate', 'accounts'].includes(req.user.role)) {
      const B = require('./books'), d = todayStr(), from = d.slice(0, 7) + '-01', r = B.build(t, from, d);
      out.books = { month: d.slice(0, 7), income_paise: r.total_income_paise, expense_paise: r.total_expense_paise, receivable_paise: r.receivable_paise, checks: r.checks.filter((c) => c.level === 'warn').length };
    }
    res.json(out);
  });
};
Object.assign(module.exports, { CATALOG, checkAll, startWorker, probe });
