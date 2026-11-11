// Case identity as the court writes it (same for every firm)
const assert = require('assert'); const { identity, splitNo } = require('../routes/ecourts'); let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const a = identity({ courtCaseData: { caseType: 'Complaint Case', caseNumber: '200700000442019', registrationNumber: '44/2019', registrationDate: '2019-02-11', filingDate: '2019-02-05', filingNumber: '330/2019' } });
ok(a.case_no === 'Complaint Case No. 44 of 2019', 'case no'); ok(a.reg_no === 'Reg no. 44 of 2019', 'reg no'); ok(a.reg_date === '2019-02-11' && a.case_date === '2019-02-05', 'dates'); ok(a.filing_no === 'Filing No: 330/2019', 'filing');
const b = identity({ courtCaseData: { caseType: 'Title Suit No.', caseNumber: '176/2019', filingNumber: '268/2019' } });
ok(b.case_no === 'Title Suit No. 176 of 2019' && b.reg_no === '', 'type already has No.');
ok(identity({ courtCaseData: { caseType: 'Misc Case', caseNumber: '38 of 2019' } }).case_no === 'Misc Case No. 38 of 2019', 'of form');
ok(identity({}).case_no === '' && identity(null).reg_no === '', 'empty safe');
ok(splitNo('abc') === null && splitNo('') === null, 'junk');
console.log('ident tests passed:', n);
