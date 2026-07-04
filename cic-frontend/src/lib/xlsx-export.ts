import { Workbook } from 'exceljs'
import { saveAs } from 'file-saver'

export type Sheet = {
  name: string
  rows: Record<string, unknown>[]
}

// Replaces the previous SheetJS `XLSX.utils.json_to_sheet` + `XLSX.writeFile`
// flow. SheetJS's npm distribution is stuck on 0.18.x with an open prototype
// pollution advisory; exceljs is actively maintained.
//
// Behaviour matches the old call sites: rows are written in insertion order
// of the first row's keys, and the header row is bolded so the output looks
// the same when opened in Excel / LibreOffice.
export async function downloadXlsx(sheets: Sheet[], filename: string): Promise<void> {
  const wb = new Workbook()
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name)
    if (sheet.rows.length === 0) continue

    const headers = Object.keys(sheet.rows[0])
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }))
    ws.getRow(1).font = { bold: true }
    ws.addRows(sheet.rows)
  }

  const buffer = await wb.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}
