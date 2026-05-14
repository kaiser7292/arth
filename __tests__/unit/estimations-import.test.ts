import {
  detectMonthColumns,
  parseForecastSheet,
} from "@/services/estimations-import";
import * as XLSX from "xlsx";

describe("detectMonthColumns", () => {
  it("detects short month names starting from April (Indian FY)", () => {
    const columns = [
      "Category",
      "Annual",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Balance",
    ];
    const result = detectMonthColumns(columns);

    expect(result).not.toBeNull();
    expect(result!.monthColumns.length).toBe(12);
    expect(result!.fyStartMonth).toBe(4); // April
    expect(result!.monthColumns[0]).toBe("Apr");
    expect(result!.monthColumns[11]).toBe("Mar");
  });

  it("detects full month names", () => {
    const columns = [
      "Category",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const result = detectMonthColumns(columns);

    expect(result).not.toBeNull();
    expect(result!.monthColumns.length).toBe(12);
    expect(result!.fyStartMonth).toBe(1); // January
  });

  it("returns null if fewer than 6 month columns", () => {
    const columns = ["Category", "Annual", "Apr", "May", "Jun"];
    expect(detectMonthColumns(columns)).toBeNull();
  });
});

describe("parseForecastSheet", () => {
  function createForecastWorkbook(): XLSX.WorkBook {
    const data = [
      {
        Category: "Car & Vehicles",
        Annual: 120000,
        Apr: 10000,
        May: 10000,
        Jun: 10000,
        Jul: 10000,
        Aug: 10000,
        Sep: 10000,
        Oct: 10000,
        Nov: 10000,
        Dec: 10000,
        Jan: 10000,
        Feb: 10000,
        Mar: 10000,
      },
      {
        Category: "Food",
        Annual: 60000,
        Apr: 5000,
        May: 5000,
        Jun: 5000,
        Jul: 5000,
        Aug: 5000,
        Sep: 5000,
        Oct: 5000,
        Nov: 5000,
        Dec: 5000,
        Jan: 5000,
        Feb: 5000,
        Mar: 5000,
      },
      {
        Category: "Total Expenses",
        Annual: 180000,
        Apr: 15000,
        May: 15000,
        Jun: 15000,
        Jul: 15000,
        Aug: 15000,
        Sep: 15000,
        Oct: 15000,
        Nov: 15000,
        Dec: 15000,
        Jan: 15000,
        Feb: 15000,
        Mar: 15000,
      },
      {
        Category: "Salary",
        Annual: 1200000,
        Apr: 100000,
        May: 100000,
        Jun: 100000,
        Jul: 100000,
        Aug: 100000,
        Sep: 100000,
        Oct: 100000,
        Nov: 100000,
        Dec: 100000,
        Jan: 100000,
        Feb: 100000,
        Mar: 100000,
      },
      {
        Category: "Savings Rate",
        Annual: 25,
        Apr: null,
        May: null,
        Jun: null,
        Jul: null,
        Aug: null,
        Sep: null,
        Oct: null,
        Nov: null,
        Dec: null,
        Jan: null,
        Feb: null,
        Mar: null,
      },
      {
        Category: "Investments",
        Annual: null,
        Apr: null,
        May: null,
        Jun: null,
        Jul: null,
        Aug: null,
        Sep: null,
        Oct: null,
        Nov: null,
        Dec: null,
        Jan: null,
        Feb: null,
        Mar: null,
      },
      {
        Category: "Mutual Funds",
        Annual: 200000,
        Apr: 16667,
        May: 16667,
        Jun: 16667,
        Jul: 16667,
        Aug: 16667,
        Sep: 16667,
        Oct: 16667,
        Nov: 16667,
        Dec: 16667,
        Jan: 16667,
        Feb: 16667,
        Mar: 16667,
      },
      {
        Category: "FD",
        Annual: 100000,
        Apr: 8333,
        May: 8333,
        Jun: 8333,
        Jul: 8333,
        Aug: 8333,
        Sep: 8333,
        Oct: 8333,
        Nov: 8333,
        Dec: 8333,
        Jan: 8333,
        Feb: 8333,
        Mar: 8333,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Forecast 2025");
    return wb;
  }

  it("parses a forecast sheet with month columns", () => {
    const wb = createForecastWorkbook();
    const result = parseForecastSheet(wb, "Forecast 2025");

    expect(result).not.toBeNull();
    expect(result!.fyStartMonth).toBe(4); // April
    expect(result!.monthColumns.length).toBe(12);
    expect(result!.labelColumn).toBe("Category");
  });

  it("extracts rows with labels and monthly values", () => {
    const wb = createForecastWorkbook();
    const result = parseForecastSheet(wb, "Forecast 2025");

    expect(result!.rows.length).toBeGreaterThan(0);

    const carRow = result!.rows.find(
      (r) => r.label === "Car & Vehicles",
    );
    expect(carRow).toBeDefined();
    expect(carRow!.annual).toBe(120000);
    expect(carRow!.monthlyValues[0]).toBe(10000); // Apr
  });

  it("detects salary row", () => {
    const wb = createForecastWorkbook();
    const result = parseForecastSheet(wb, "Forecast 2025");

    const salaryRow = result!.rows.find((r) => r.label === "Salary");
    expect(salaryRow).toBeDefined();
    expect(salaryRow!.annual).toBe(1200000);
  });

  it("detects savings rate row", () => {
    const wb = createForecastWorkbook();
    const result = parseForecastSheet(wb, "Forecast 2025");

    const srRow = result!.rows.find((r) => r.label === "Savings Rate");
    expect(srRow).toBeDefined();
    expect(srRow!.annual).toBe(25);
  });

  it("returns null for sheet without month columns", () => {
    const ws = XLSX.utils.json_to_sheet([
      { Name: "Foo", Value: 100 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NoMonths");

    expect(parseForecastSheet(wb, "NoMonths")).toBeNull();
  });
});
