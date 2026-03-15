import React, { useEffect, useMemo, useRef, useState } from "react";
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
const ID_COLUMNS = new Set(["admision"]);

const COLUMN_ALIASES = {
  admision: ["admision"],
  usuario: ["usuario"],
  fecha_ingreso: ["fecha_ingreso"],
  fecha_egreso: ["fecha_egreso"],
  estrato: ["estrato"],
  permanencia: ["permanencia"],
  centro_servicio: ["centro_servicio"],
  paciente: ["paciente"],
  vr_servicios: ["vr_servicios"],
  vr_factura: ["vr_factura"],
};

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

function normalizeIdentifier(value) {
  if (value == null || value === "") return "";
  return String(value).trim();
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

  const numericFromString = Number(stringValue.replace(",", "."));
  if (Number.isFinite(numericFromString) && numericFromString > 0) {
    const dateParts = XLSX.SSF.parse_date_code(numericFromString);
    if (dateParts) {
      return formatDateString(dateParts.y, dateParts.m, dateParts.d);
    }
  }

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

function toSortableDateNumber(dateValue) {
  const normalized = normalizeDateValue(dateValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return Number(normalized.replace(/-/g, ""));
  }
  return Number.POSITIVE_INFINITY;
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
  const { headers, startIndex } = detectHeaderRow(raw);

  return raw.slice(startIndex + 1).map((row) => {
    const obj = {};

    headers.forEach((h, i) => {
      const value = cleanValue(row[i]);
      if (DATE_COLUMNS.has(h)) {
        obj[h] = normalizeDateValue(value);
        return;
      }

      if (ID_COLUMNS.has(h)) {
        obj[h] = normalizeIdentifier(value);
        return;
      }

      obj[h] = value;
    });

    return obj;
  }).filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim() !== "")
  );
}

function getCanonicalHeader(header) {
  const normalized = normalizeHeader(header);

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(normalized)) {
      return canonical;
    }
  }

  return normalized;
}

function detectHeaderRow(rawRows) {
  let bestIndex = 0;
  let bestHeaders = [];
  let bestScore = -1;

  rawRows.forEach((row, index) => {
    const headers = row.map(getCanonicalHeader);
    const uniqueHeaders = new Set(headers.filter(Boolean));
    const score = [...uniqueHeaders].filter((header) =>
      Object.hasOwn(COLUMN_ALIASES, header)
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      bestHeaders = headers;
    }
  });

  return {
    headers: bestHeaders,
    startIndex: bestIndex,
  };
}

function missingColumns(rows, requiredColumns) {
  const headers = Object.keys(rows[0] || {});
  const headersSet = new Set(headers);
  return requiredColumns.filter((col) => !headersSet.has(col));
}

function hasColumns(rows, requiredColumns) {
  return missingColumns(rows, requiredColumns).length === 0;
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

function getHeaders(rows) {
  return Object.keys(rows[0] || {});
}

function getDefaultField(rows) {
  return getHeaders(rows)[0] || "";
}

function getFieldValues(rows, field) {
  if (!rows.length || !field) return [];

  return [...new Set(
    rows
      .map((row) => String(row[field] ?? "").trim() || "Sin dato")
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "es"));
}

const ALL_FILTER_VALUE = "__ALL__";

function filterRowsByFieldValue(rows, field, value) {
  if (!field || !value || value === ALL_FILTER_VALUE) return rows;

  return rows.filter(
    (row) => (String(row[field] ?? "").trim() || "Sin dato") === value
  );
}

function ScrollableTable({ rows, formatter }) {
  const topScrollRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const tableRef = useRef(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    function updateScrollWidth() {
      if (!tableRef.current) return;
      setScrollWidth(tableRef.current.scrollWidth);
    }

    updateScrollWidth();

    if (!tableRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateScrollWidth();
    });

    observer.observe(tableRef.current);

    return () => observer.disconnect();
  }, [rows]);

  function syncScroll(source, target) {
    if (!source.current || !target.current) return;
    target.current.scrollLeft = source.current.scrollLeft;
  }

  if (!rows.length) return <p>No hay datos</p>;

  const headers = Object.keys(rows[0]);

  return (
    <div className="table-block">
      <div
        className="table-scrollbar table-scrollbar-top"
        ref={topScrollRef}
        onScroll={() => syncScroll(topScrollRef, bottomScrollRef)}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      <div
        className="table-scrollbar table-scrollbar-bottom"
        ref={bottomScrollRef}
        onScroll={() => syncScroll(bottomScrollRef, topScrollRef)}
      >
        <table ref={tableRef}>
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
      </div>
    </div>
  );
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
  const [reportConfig, setReportConfig] = useState({});

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
    if (!sistemaFile) {
      setLoadError("Selecciona el archivo Sistema antes de alimentar la consulta.");
      return;
    }

    setIsLoading(true);
    setLoadError("");
    setLoadMessage("");

    try {
      const nextSistemaRows = await parseExcelFile(sistemaFile);
      const sistemaCanReplaceSio = hasColumns(
        nextSistemaRows,
        REQUIRED_SIO_COLUMNS
      );

      if (!sioFile && !sistemaCanReplaceSio) {
        throw new Error(
          "Selecciona el archivo SIO o carga un Sistema que también incluya las columnas de SIO."
        );
      }

      const nextSioRows = sioFile
        ? await parseExcelFile(sioFile)
        : nextSistemaRows;

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
        sioFile
          ? `Consulta alimentada: ${nextSistemaRows.length} filas Sistema y ${nextSioRows.length} filas SIO.`
          : `Consulta alimentada desde Sistema: ${nextSistemaRows.length} filas. Se reutilizó este archivo como fuente SIO porque ya contiene todas las columnas necesarias.`
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
          fecha_egreso: sio.fecha_egreso,
          historia: sio.historia,
          tipo_atencion: sio.tipo_de_atencion,
          empresa: sio.empresa,
          permanencia: sio.permanencia,
          cuenta: sio.cuenta,
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
    return sioRows
      .filter((s) => {
        const matches = sistemaMap.get(s.admision);

        if (!matches) return true;

        return matches.some((m) => toNumber(m.vr_factura) === 0);
      })
      .sort((a, b) => {
        const servicioA = String(a.centro_servicio || "");
        const servicioB = String(b.centro_servicio || "");
        const byServicio = servicioA.localeCompare(servicioB, "es");
        if (byServicio !== 0) return byServicio;

        const dateA = toSortableDateNumber(a.fecha_ingreso);
        const dateB = toSortableDateNumber(b.fecha_ingreso);
        return dateA - dateB;
      });
  }, [sioRows, sistemaMap]);

  const noCoinciden = useMemo(() => {
    const list = [];

    sioRows.forEach((r) => {
      if (!sistemaMap.has(r.admision))
        list.push({
          estado: "Existe en SIO y no en Sistema",
          admision: r.admision,
          fecha_ingreso: r.fecha_ingreso,
          fecha_egreso: r.fecha_egreso,
          historia: r.historia || "",
          tipo_atencion: r.tipo_de_atencion || "",
          empresa: r.empresa || "",
          permanencia: r.permanencia || "",
          cuenta: r.cuenta || "",
          centro_servicio: r.centro_servicio || "",
          paciente: r.paciente,
        });
    });

    sistemaRows.forEach((r) => {
      if (!sioMap.has(r.admision))
        list.push({
          estado: "Existe en Sistema y no en SIO",
          admision: r.admision,
          fecha_ingreso: r.fecha_ingreso || "",
          fecha_egreso: r.fecha_egreso || "",
          historia: r.historia || "",
          tipo_atencion: r.tipo_atencion || "",
          empresa: r.empresa || "",
          permanencia: r.permanencia || "",
          cuenta: r.cuenta || "",
          centro_servicio: "",
          paciente: r.paciente || "",
        });
    });

    return list.sort((a, b) => {
      const servicioA = String(a.centro_servicio || "");
      const servicioB = String(b.centro_servicio || "");
      const byServicio = servicioA.localeCompare(servicioB, "es");
      if (byServicio !== 0) return byServicio;

      return String(a.admision || "").localeCompare(String(b.admision || ""), "es");
    });
  }, [sioRows, sistemaRows]);

  const filtered = cruces.filter((r) =>
    Object.values(r).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase())
    )
  );

  useEffect(() => {
    const reportRows = {
      cruce: cruces,
      resumen_facturador: resumenFacturador,
      admisiones_empresa_mes: admisionesPorEmpresaMes,
      consolidado_empresa_mes: consolidadoEmpresaPorMes,
      sin_factura: sinFactura,
      no_coinciden: noCoinciden,
    };

    setReportConfig((current) => {
      let changed = false;
      const next = { ...current };

      Object.entries(reportRows).forEach(([key, rows]) => {
        const headers = getHeaders(rows);
        const defaultField = headers[0] || "";
        const currentField = next[key]?.field || "";
        const field = headers.includes(currentField) ? currentField : defaultField;
        const values = getFieldValues(rows, field);
        const currentValue = next[key]?.value || "";
        const value = values.includes(currentValue)
          ? currentValue
          : ALL_FILTER_VALUE;

        if (!headers.length) {
          if (next[key]?.field || next[key]?.value) {
            next[key] = { field: "", value: "" };
            changed = true;
          }
          return;
        }

        if (next[key]?.field !== field || next[key]?.value !== value) {
          next[key] = { field, value };
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [
    cruces,
    resumenFacturador,
    admisionesPorEmpresaMes,
    consolidadoEmpresaPorMes,
    sinFactura,
    noCoinciden,
  ]);

  function exportExcel(name, rows) {
    const ws = XLSX.utils.json_to_sheet(rows);

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "reporte");

    XLSX.writeFile(wb, name + ".xlsx");
  }

  function renderTable(rows, formatter) {
    return <ScrollableTable rows={rows} formatter={formatter} />;
  }

  function getReportFilteredRows(reportKey, rows) {
    const field = reportConfig[reportKey]?.field || "";
    const value = reportConfig[reportKey]?.value || "";

    return filterRowsByFieldValue(rows, field, value);
  }

  function renderReportActions(reportKey, exportName, rows, sourceRows = rows) {
    const headers = getHeaders(sourceRows);
    const selectedField =
      reportConfig[reportKey]?.field || getDefaultField(sourceRows);
    const fieldValues = getFieldValues(rows, selectedField);
    const selectedValue =
      reportConfig[reportKey]?.value ||
      ALL_FILTER_VALUE;

    return (
      <div className="report-actions">
        <button onClick={() => exportExcel(`${exportName}_general`, rows)}>
          Exportar informe general
        </button>

        <div className="report-group-actions">
          <select
            value={selectedField}
            onChange={(e) =>
              setReportConfig((current) => {
                const field = e.target.value;
                const values = getFieldValues(rows, field);

                return {
                  ...current,
                  [reportKey]: {
                    field,
                    value: ALL_FILTER_VALUE,
                  },
                };
              })
            }
            disabled={!headers.length}
          >
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>

          <select
            value={selectedValue}
            onChange={(e) =>
              setReportConfig((current) => ({
                ...current,
                [reportKey]: {
                  field: selectedField,
                  value: e.target.value,
                },
              }))
            }
            disabled={!fieldValues.length}
          >
            <option value={ALL_FILTER_VALUE}>Todos</option>
            {fieldValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button
            onClick={() =>
              exportExcel(
                selectedValue === ALL_FILTER_VALUE
                  ? `${exportName}_general`
                  : `${exportName}_${selectedField}_${selectedValue}`,
                filterRowsByFieldValue(rows, selectedField, selectedValue)
              )
            }
            disabled={!rows.length || !selectedField}
          >
            Exportar informe filtrado
          </button>

        </div>
      </div>
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

      {renderReportActions("cruce", "cruce", filtered, cruces)}

      {renderTable(getReportFilteredRows("cruce", filtered))}

      <h2>Resumen por Facturador</h2>

      {renderReportActions(
        "resumen_facturador",
        "resumen_facturador",
        resumenFacturador
      )}

      {renderTable(getReportFilteredRows("resumen_facturador", resumenFacturador), (header, value) => {
        if (header === "total_servicios" || header === "total_factura") {
          return formatThousands(value);
        }

        return value;
      })}

      <h2>Admisiones por Empresa y Mes</h2>

      {renderReportActions(
        "admisiones_empresa_mes",
        "admisiones_empresa_mes",
        admisionesPorEmpresaMes
      )}

      {renderTable(getReportFilteredRows("admisiones_empresa_mes", admisionesPorEmpresaMes))}

      <h3>Consolidado por Empresa (Admisiones por Mes y Total)</h3>
      {renderReportActions(
        "consolidado_empresa_mes",
        "consolidado_empresa_mes",
        consolidadoEmpresaPorMes
      )}
      {renderTable(getReportFilteredRows("consolidado_empresa_mes", consolidadoEmpresaPorMes))}

      <h2>Admisiones sin factura</h2>

      {renderReportActions("sin_factura", "sin_factura", sinFactura)}

      {renderTable(getReportFilteredRows("sin_factura", sinFactura))}

      <h2>No coinciden</h2>

      {renderReportActions("no_coinciden", "no_coinciden", noCoinciden)}

      {renderTable(getReportFilteredRows("no_coinciden", noCoinciden))}
    </div>
  );
}
