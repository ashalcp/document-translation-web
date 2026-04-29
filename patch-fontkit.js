const fs = require('fs');
const filePath = require('path').join(__dirname, 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.js');
let code = fs.readFileSync(filePath, 'utf8');
let changed = 0;

// Revert previous wrong fix in getAnchor if still present
const wrongFix = /\/\/ guard null GPOS anchors[^\n]*\n\s*if \(!anchor\) return \{ x: 0, y: 0 \};[^\n]*\n/;
if (wrongFix.test(code)) { code = code.replace(wrongFix, ''); changed++; console.log('Reverted wrong getAnchor guard'); }

// Case 4: mark-to-base
const c4o = '\t          this.applyAnchor(markRecord, baseAnchor, baseGlyphIndex);\n\t          return true;\n\t        }\n\n\t      case 5:';
const c4n = '\t          if (!baseAnchor) { return false; } // null anchor = skip\n\t          this.applyAnchor(markRecord, baseAnchor, baseGlyphIndex);\n\t          return true;\n\t        }\n\n\t      case 5:';
if (code.includes(c4o)) { code = code.replace(c4o, c4n); changed++; console.log('Patched case4 mark-to-base'); }
else console.warn('case4 not found or already patched');

// Case 5: mark-to-ligature
const c5o = '\t          this.applyAnchor(_markRecord, _baseAnchor, _baseGlyphIndex);\n\t          return true;\n\t        }\n\n\t      case 6:';
const c5n = '\t          if (!_baseAnchor) { return false; } // null anchor = skip\n\t          this.applyAnchor(_markRecord, _baseAnchor, _baseGlyphIndex);\n\t          return true;\n\t        }\n\n\t      case 6:';
if (code.includes(c5o)) { code = code.replace(c5o, c5n); changed++; console.log('Patched case5 mark-to-lig'); }
else console.warn('case5 not found or already patched');

// Case 6: mark-to-mark
const c6o = '\t          this.applyAnchor(_markRecord2, _baseAnchor2, prevIndex);\n\t          return true;\n\t        }\n\n\t      case 7:';
const c6n = '\t          if (!_baseAnchor2) { return false; } // null anchor = skip\n\t          this.applyAnchor(_markRecord2, _baseAnchor2, prevIndex);\n\t          return true;\n\t        }\n\n\t      case 7:';
if (code.includes(c6o)) { code = code.replace(c6o, c6n); changed++; console.log('Patched case6 mark-to-mark'); }
else console.warn('case6 not found or already patched');

fs.writeFileSync(filePath, code);
const guards = (code.match(/null anchor = skip/g) || []).length;
console.log('Done. changes=' + changed + ' guards=' + guards);
