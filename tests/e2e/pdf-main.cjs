// Electron main script: prints an HTML file to PDF. Usage: electron pdf-main.cjs <in.html> <out.pdf>
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')

const [input, output] = process.argv.slice(-2)
app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200 })
  try {
    await win.loadFile(input)
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.55, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#777;padding:0 12mm;display:flex;justify-content:space-between;font-family:-apple-system,Helvetica,Arial,sans-serif"><span>Mind Palace · end-to-end test report</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
    })
    writeFileSync(output, pdf)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
