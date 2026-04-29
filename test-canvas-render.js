/**
 * Test script for canvas-based complex script rendering.
 * Run with: node test-canvas-render.js
 * Opens the result PDF automatically for visual inspection.
 */

require('./node_modules/regenerator-runtime/runtime')
const { createTranslatedPDF } = require('./dist-server/exporter')
const { PDFDocument } = require('./node_modules/pdf-lib')
const fs = require('fs')
const { execSync } = require('child_process')

async function run() {
  // --- Create a blank 3-page input PDF ---
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  doc.addPage([612, 792])
  doc.addPage([612, 792])
  const inputPath = '/tmp/test-input-blank.pdf'
  fs.writeFileSync(inputPath, await doc.save())

  // --- Paragraphs to test ---
  // boundingBox: [x1,y1, x2,y2, x3,y3, x4,y4]  (in inches, 72dpi)
  // Page is 8.5 x 11 inches. y increases downward.
  const paragraphs = [
    // ── Page 1: Malayalam ──
    {
      pageNumber: 1,
      text: 'ഭരണഘടന ഇന്ത്യൻ ദേശീയ ഭൂമി ജനങ്ങൾ',
      boundingBox: [0.5, 0.5,  7.5, 0.5,  7.5, 0.9,  0.5, 0.9],
      fontSize: 14,
      color: '#111111',
    },
    {
      pageNumber: 1,
      text: 'കേരള സർക്കാർ നയം — ഒരു ദീർഘവും സങ്കീർണ്ണവുമായ വാക്യം',
      boundingBox: [0.5, 1.1,  7.5, 1.1,  7.5, 1.5,  0.5, 1.5],
      fontSize: 13,
      color: '#1a1a6e',
    },
    {
      pageNumber: 1,
      text: 'നമസ്കാരം',   // single word — should be perfect
      boundingBox: [0.5, 1.7,  3.0, 1.7,  3.0, 2.1,  0.5, 2.1],
      fontSize: 18,
      color: '#006600',
    },
    {
      pageNumber: 1,
      text: 'ഇന്ത്യൻ ഭരണഘടന 1950-ൽ നിലവിൽ വന്നു. ഇത് ലോകത്തിലെ ഏറ്റവും വലിയ ലിഖിത ഭരണഘടനയാണ്.',
      boundingBox: [0.5, 2.3,  7.5, 2.3,  7.5, 3.0,  0.5, 3.0],
      fontSize: 12,
      color: '#222222',
    },

    // ── Page 2: Devanagari (Hindi) ──
    {
      pageNumber: 2,
      text: 'भारतीय संविधान और राष्ट्रीय नीति',
      boundingBox: [0.5, 0.5,  7.5, 0.5,  7.5, 1.0,  0.5, 1.0],
      fontSize: 16,
      color: '#111111',
    },
    {
      pageNumber: 2,
      text: 'यह एक लंबा परीक्षण वाक्य है जिसमें कई शब्द हैं।',
      boundingBox: [0.5, 1.2,  7.5, 1.2,  7.5, 1.7,  0.5, 1.7],
      fontSize: 13,
    },

    // ── Page 3: Tamil ──
    {
      pageNumber: 3,
      text: 'இந்திய அரசியலமைப்பு மற்றும் தேசிய கொள்கை',
      boundingBox: [0.5, 0.5,  7.5, 0.5,  7.5, 1.0,  0.5, 1.0],
      fontSize: 14,
      color: '#111111',
    },
    {
      pageNumber: 3,
      text: 'தமிழ்நாடு அரசு திட்டங்கள் மற்றும் செயல்முறைகள்',
      boundingBox: [0.5, 1.2,  7.5, 1.2,  7.5, 1.6,  0.5, 1.6],
      fontSize: 13,
    },
  ]

  const outputPath = '/tmp/canvas-render-test.pdf'
  console.log('\n🧪 Running canvas render test...\n')
  await createTranslatedPDF(inputPath, paragraphs, outputPath)

  console.log(`\n✅ Output: ${outputPath}`)
  console.log('   Opening PDF...\n')
  execSync(`open "${outputPath}"`)
}

run().catch(e => { console.error('❌ Error:', e.stack); process.exit(1) })
