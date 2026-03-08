import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Search } from "lucide-react";
import "./App.css";

const REQUIRED_SISTEMA_COLUMNS = [
  "admision",
  "vr_servicios",
  "vr_factura",
];

const REQUIRED_SIO_COLUMNS = [
  "admision",
  "usuario",
  "fecha_ingreso",
  "fecha_egreso",
  "estrato",
  "permanencia",
  "centro_servicio",
  "paciente",
];

const DATE_COLUMNS = new Set(["fecha_ingreso", "fecha_egreso"]);

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanValue(value) {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : value;
}

function formatDateString(year, month, day) {
  const safeYear = String(year).padStart(4, "0");
  const safeMonth = String(month).padStart(2, "0");
  const safeDay = String(day).padStart(2, "0");
  return `${safeYear}-${safeMonth}-${safeDay}`;
}

function normalizeDateValue(value) {
  if (value == null || value === "") return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateString(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate()
    );
  }

  if (typeof value === "number") {
    const dateParts = XLSX.SSF.parse_date_code(value);
    if (dateParts) {
      return formatDateString(dateParts.y, dateParts.m, dateParts.d);
    }
  }

  const stringValue = String(value).trim();
  if (!stringValue) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return stringValue;
  }

  const normalized = stringValue.replace(/\./g, "/").replace(/-/g, "/");

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("/").map(Number);
    return formatDateString(year, month, day);
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(normalized)) {
    const [day, month, yearRaw] = normalized.split("/").map(Number);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return formatDateString(year, month, day);
  }

  return stringValue;
}

function extractMonth(dateValue) {
  const normalized = normalizeDateValue(dateValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized.slice(0, 7);
  }
  return "Sin fecha";
}

function formatThousands(value) {
  const num = toNumber(value);
  return num.toLocaleString("es-CO");
}

function toNumber(value) {
  if (!value) return 0;

  const cleaned = String(value)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function rowsFromSheet(sheet) {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = raw[0] || [];

  const headers = headerRow.map(normalizeHeader);

  return raw.slice(1).map((row) => {
    const obj = {};

    headers.forEach((h, i) => {
      const value = cleanValue(row[i]);
      obj[h] = DATE_COLUMNS.has(h) ? normalizeDateValue(value) : value;
    });

    return obj;
  });
}

function missingColumns(rows, requiredColumns) {
  const headers = Object.keys(rows[0] || {});
  const headersSet = new Set(headers);
  return requiredColumns.filter((col) => !headersSet.has(col));
}

function buildFacturadorName(row) {
  return [
    row.primer_nombre,
    row.segundo_nombre,
    row.primer_apellido,
    row.segundo_apellido,
  ]
    .filter((part) => String(part ?? "").trim() !== "")
    .join(" ");
}

export default function App() {
  const [sistemaRows, setSistemaRows] = useState([]);
  const [sioRows, setSioRows] = useState([]);

  const [sistemaName, setSistemaName] = useState("");
  const [sioName, setSioName] = useState("");
  const [sistemaFile, setSistemaFile] = useState(null);
  const [sioFile, setSioFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMessage, setLoadMessage] = useState("");

  const [search, setSearch] = useState("");

  async function parseExcelFile(file) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return rowsFromSheet(sheet);
  }

  function handleFileSelect(e, type) {
    const file = e.target.files[0];
    if (!file) return;

    setLoadError("");
    setLoadMessage("");

    if (type === "sistema") {
      setSistemaFile(file);
      setSistemaName(file.name);
      return;
    }

    setSioFile(file);
    setSioName(file.name);
  }

  async function handleLoadData() {
    if (!sistemaFile || !sioFile) {
      setLoadError("Selecciona los dos archivos antes de alimentar la consulta.");
      return;
    }

    setIsLoading(true);
    setLoadError("");
    setLoadMessage("");

    try {
      const [nextSistemaRows, nextSioRows] = await Promise.all([
        parseExcelFile(sistemaFile),
        parseExcelFile(sioFile),
      ]);

      const missingSistema = missingColumns(
        nextSistemaRows,
        REQUIRED_SISTEMA_COLUMNS
      );
      const missingSio = missingColumns(nextSioRows, REQUIRED_SIO_COLUMNS);

      if (missingSistema.length || missingSio.length) {
        const issues = [];

        if (missingSistema.length) {
          issues.push(`Sistema: ${missingSistema.join(", ")}`);
        }

        if (missingSio.length) {
          issues.push(`SIO: ${missingSio.join(", ")}`);
        }

        throw new Error(`Faltan columnas requeridas. ${issues.join(" | ")}`);
      }

      setSistemaRows(nextSistemaRows);
      setSioRows(nextSioRows);
      setLoadMessage(
        `Consulta alimentada: ${nextSistemaRows.length} filas Sistema y ${nextSioRows.length} filas SIO.`
      );
    } catch (error) {
      setLoadError(
        error?.message ||
          "No se pudieron procesar los archivos. Revisa formato y columnas."
      );
    } finally {
      setIsLoading(false);
    }
  }

  const sistemaMap = useMemo(() => {
    const map = new Map();

    sistemaRows.forEach((r) => {
      const adm = r.admision;

      if (!map.has(adm)) map.set(adm, []);

      map.get(adm).push(r);
    });

    return map;
  }, [sistemaRows]);

  const sioMap = useMemo(() => {
    const map = new Map();

    sioRows.forEach((r) => {
      const adm = r.admision;

      if (!map.has(adm)) map.set(adm, []);

      map.get(adm).push(r);
    });

    return map;
  }, [sioRows]);

  const cruces = useMemo(() => {
    const result = [];
    const includeFacturador = sistemaRows.some(
      (row) => buildFacturadorName(row) !== ""
    );

    sioRows.forEach((sio) => {
      const matches = sistemaMap.get(sio.admision) || [];

      matches.forEach((s) => {
        const nombreFacturador = buildFacturadorName(s);
        result.push({
          usuario: sio.usuario,
          ...(includeFacturador && { nombre_facturador: nombreFacturador }),
          admision: sio.admision,
          fecha_ingreso: sio.fecha_ingreso,
          sala: sio.centro_servicio,
          paciente: sio.paciente,
          vr_servicios: s.vr_servicios,
          vr_factura: s.vr_factura,
        });
      });
    });

    return result;
  }, [sioRows, sistemaMap]);

  const resumenFacturador = useMemo(() => {
    const map = new Map();

    cruces.forEach((r) => {
      const facturador = r.usuario || "Sin facturador";

      if (!map.has(facturador))
        map.set(facturador, {
          facturador,
          total_admisiones: 0,
          total_servicios: 0,
          total_factura: 0,
        });

      const row = map.get(facturador);

      row.total_admisiones++;

      row.total_servicios += toNumber(r.vr_servicios);

      row.total_factura += toNumber(r.vr_factura);
    });

    return [...map.values()].sort(
      (a, b) => b.total_admisiones - a.total_admisiones
    );
  }, [cruces]);

  const admisionesPorEmpresaMes = useMemo(() => {
    const map = new Map();

    sioRows.forEach((row) => {
      const empresa = row.empresa || row.centro_servicio || "Sin empresa";
      const mes = extractMonth(row.fecha_ingreso);
      const key = `${empresa}__${mes}`;

      if (!map.has(key)) {
        map.set(key, {
          empresa,
          mes,
          admisiones: new Set(),
        });
      }

      const group = map.get(key);
      group.admisiones.add(String(row.admision ?? "").trim());
    });

    return [...map.values()]
      .map((item) => ({
        empresa: item.empresa,
        mes: item.mes,
        total_admisiones: item.admisiones.size,
      }))
      .sort((a, b) => {
        if (a.mes === b.mes) {
          return b.total_admisiones - a.total_admisiones;
        }
        return a.mes < b.mes ? 1 : -1;
      });
  }, [sioRows]);

  const consolidadoEmpresaPorMes = useMemo(() => {
    const meses = [...new Set(admisionesPorEmpresaMes.map((row) => row.mes))].sort(
      (a, b) => (a < b ? -1 : 1)
    );
    const map = new Map();

    admisionesPorEmpresaMes.forEach((row) => {
      if (!map.has(row.empresa)) {
        const base = { empresa: row.empresa };

        meses.forEach((mes) => {
          base[mes] = 0;
        });

        base.total_admisiones = 0;
        map.set(row.empresa, base);
      }

      const group = map.get(row.empresa);
      group[row.mes] = toNumber(row.total_admisiones);
      group.total_admisiones += toNumber(row.total_admisiones);
    });

    return [...map.values()].sort(
      (a, b) => b.total_admisiones - a.total_admisiones
    );
  }, [admisionesPorEmpresaMes]);

  const sinFactura = useMemo(() => {
    return sioRows.filter((s) => {
      const matches = sistemaMap.get(s.admision);

      if (!matches) return true;

      return matches.some((m) => toNumber(m.vr_factura) === 0);
    });
  }, [sioRows, sistemaMap]);

  const noCoinciden = useMemo(() => {
    const list = [];

    sioRows.forEach((r) => {
      if (!sistemaMap.has(r.admision))
        list.push({
          estado: "Existe en SIO y no en Sistema",
          admision: r.admision,
          centro_servicio: r.centro_servicio || "",
          paciente: r.paciente,
        });
    });

    sistemaRows.forEach((r) => {
      if (!sioMap.has(r.admision))
        list.push({
          estado: "Existe en Sistema y no en SIO",
          admision: r.admision,
          centro_servicio: "",
        });
    });

    return list;
  }, [sioRows, sistemaRows]);

  const filtered = cruces.filter((r) =>
    Object.values(r).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase())
    )
  );

  function exportExcel(name, rows) {
    const ws = XLSX.utils.json_to_sheet(rows);

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "reporte");

    XLSX.writeFile(wb, name + ".xlsx");
  }

  function renderTable(rows, formatter) {
    if (!rows.length) return <p>No hay datos</p>;

    const headers = Object.keys(rows[0]);

    return (
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{formatter ? formatter(h, r[h], r) : r[h]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="app-shell">
      <h1>Control Facturación SIO vs Sistema</h1>

      <div className="upload-area">
        <div className="upload-row">
          <div className="upload-label">
            <Upload size={18} />
            <span>Excel Sistema</span>
          </div>

          <label className="file-btn">
            Seleccionar archivo
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileSelect(e, "sistema")}
              hidden
            />
          </label>

          <span className="file-name">
            {sistemaName || "Sin archivo seleccionado"}
          </span>
        </div>

        <div className="upload-row">
          <div className="upload-label">
            <FileSpreadsheet size={18} />
            <span>Excel SIO</span>
          </div>

          <label className="file-btn">
            Seleccionar archivo
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileSelect(e, "sio")}
              hidden
            />
          </label>

          <span className="file-name">
            {sioName || "Sin archivo seleccionado"}
          </span>
        </div>

        <button onClick={handleLoadData} disabled={isLoading}>
          {isLoading ? "Procesando..." : "Alimentar consulta"}
        </button>

        {loadError && <p className="status error">{loadError}</p>}
        {loadMessage && <p className="status success">{loadMessage}</p>}
      </div>

      <div className="stats">
        <div>Sistema: {sistemaRows.length}</div>
        <div>SIO: {sioRows.length}</div>
        <div>Cruces: {cruces.length}</div>
        <div>No coinciden: {noCoinciden.length}</div>
      </div>

      <div className="search">
        <Search size={16} />

        <input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <h2>Cruce Sistema vs SIO</h2>

      <button onClick={() => exportExcel("cruce", filtered)}>
        Exportar Excel
      </button>

      {renderTable(filtered)}

      <h2>Resumen por Facturador</h2>

      <button onClick={() => exportExcel("resumen_facturador", resumenFacturador)}>
        Exportar Excel
      </button>

      {renderTable(resumenFacturador, (header, value) => {
        if (header === "total_servicios" || header === "total_factura") {
          return formatThousands(value);
        }

        return value;
      })}

      <h2>Admisiones por Empresa y Mes</h2>

      <button onClick={() => exportExcel("admisiones_empresa_mes", admisionesPorEmpresaMes)}>
        Exportar Excel
      </button>

      {renderTable(admisionesPorEmpresaMes)}

      <h3>Consolidado por Empresa (Admisiones por Mes y Total)</h3>
      {renderTable(consolidadoEmpresaPorMes)}

      <h2>Admisiones sin factura</h2>

      <button onClick={() => exportExcel("sin_factura", sinFactura)}>
        Exportar Excel
      </button>

      {renderTable(sinFactura)}

      <h2>No coinciden</h2>

      <button onClick={() => exportExcel("no_coinciden", noCoinciden)}>
        Exportar Excel
      </button>

      {renderTable(noCoinciden)}
    </div>
  );
}
