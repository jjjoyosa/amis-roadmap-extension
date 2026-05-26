import { CurriculumEngine } from "../engine/CurriculumEngine.js";
import { AmisAPI } from "../services/amisApi.js";

const app = document.getElementById("app");

const state = {
    grades: null, profile: null, curriculumMap: null, programId: null,
    lastTermType: null, targetTerm: null, isOverloading: false   
};

function calculateGWA(gradesData) {
    let totalPoints = 0, totalUnits = 0;
    const ignoredPrefixes = ["HK", "NSTP"]; 
    Object.values(gradesData || {}).forEach(term => {
        term.values?.forEach(row => {
            const code = row.course?.course_code || "";
            if (ignoredPrefixes.some(prefix => code.toUpperCase().startsWith(prefix))) return; 
            const grade = parseFloat(row.grade);
            const units = parseFloat(row.unit_taken);
            if (!isNaN(grade) && !isNaN(units) && units > 0) {
                totalPoints += (grade * units);
                totalUnits += units;
            }
        });
    });
    return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(3) : "N/A";
}

function analyzeAMISTerms(gradesData) {
    if (!gradesData || Object.keys(gradesData).length === 0) return { last: null, defaultNext: "1" };
    let terms = Object.keys(gradesData).sort(); 
    const latestTermKey = terms[terms.length - 1];
    const latestTermData = gradesData[latestTermKey];
    if (latestTermData && latestTermData.units_passed === 0 && terms.length > 1) terms.pop(); 

    const lastTermKey = terms[terms.length - 1]; 
    if (lastTermKey.endsWith('1')) return { last: "1", defaultNext: "2" }; 
    if (lastTermKey.endsWith('2')) return { last: "2", defaultNext: "M" }; 
    return { last: "M", defaultNext: "1" }; 
}

async function render() {
    const config = state.curriculumMap[state.programId];
    let curriculumOptions = [];
    let curriculumFile;

    if (typeof config === "string") {
        curriculumFile = config;
    } else {
        curriculumOptions = config.options || [];
        curriculumFile = localStorage.getItem(`curriculum_${state.programId}`) || config.default;
    }

    const curriculum = await fetch(chrome.runtime.getURL(`curriculums_with_prereqs/${curriculumFile}`)).then(r => r.json());
    const gradesData = state.grades.student_grades || state.grades;

    const records = state.profile.user.student.program_records;
    const activeRecord = records.find(r => r.status === 'ACTIVE' || r.is_active) || records[0];
    const classification = activeRecord.classification;


    const passed = [];
    Object.values(gradesData || {}).forEach(term => {
        term.values?.forEach(row => {
            const code = row.course?.course_code;
            const grade = row.grade;
            const ok = (parseFloat(grade) >= 1 && parseFloat(grade) <= 3) || ["S", "P"].includes(grade?.toUpperCase());
            if (ok && code) passed.push(code.trim());
        });
    });

    const gwa = calculateGWA(gradesData);
    const apiUnitsPassed = Object.values(gradesData || {}).reduce((total, term) => total + (term.units_passed || 0), 0);
    
    const engine = new CurriculumEngine(curriculum, [["HK 12", "HK 13"], ["HIST 1", "KAS 1"]], 
        { HK: { minUnits: 6, filter: code => ["HK 12", "HK 13"].includes(code) } }, {}
    );

    const report = engine.analyzeRoadmap(passed, classification);
    const path = engine.generateOptimalPath(report, state.targetTerm, 15, 20, 7, state.isOverloading);

    const totalAcadUnits = path.recommendedCourses.filter(c => c.category !== "NON-ACAD").reduce((sum, c) => sum + (c.units || 0), 0);
    const totalNonAcadUnits = path.recommendedCourses.filter(c => c.category === "NON-ACAD").reduce((sum, c) => sum + (c.units || 0), 0);

    
    let termOptionsHTML = "";
    if (state.lastTermType === "1") {
        
        termOptionsHTML = `<option value="2" selected>2nd Sem</option>`;
    } else if (state.lastTermType === "2") {
        
        termOptionsHTML = `
            <option value="M" ${state.targetTerm === "M" ? "selected" : ""}>Midyear</option>
            <option value="1" ${state.targetTerm === "1" ? "selected" : ""}>1st Sem</option>
        `;
    } else {
        
        termOptionsHTML = `<option value="1" selected>1st Sem</option>`;
    }

    app.innerHTML = `
        <div class="header-container">
            <div class="header-left">
                <span>🎓 ${state.programId}</span>
                ${curriculumOptions.length ? `
                    <select id="track">
                        ${curriculumOptions.map(o => `<option value="${o.file}" ${o.file === curriculumFile ? "selected" : ""}>${o.label}</option>`).join("")}
                    </select>` : ""}
                
                <select id="termSelector" style="margin-left: 5px; padding: 2px; border-radius: 4px;">
                    ${termOptionsHTML}
                </select>
                <label style="font-size: 11px; margin-left: 5px; display: flex; align-items: center; gap: 3px;">
                    <input type="checkbox" id="overloadToggle" ${state.isOverloading ? "checked" : ""}> 
                    Overload
                </label>
            </div>
            
            <div class="header-right">
                <span>GWA: ${gwa}</span>
                <button id="exportBtn">🖨️ PDF</button>
            </div>
        </div>
        
        <div class="stats">
            <div class="stat">Total Units Left: <b>${path.remainingAcadUnits}</b></div>
            <div class="stat" style="font-size: 11px;">
                Est. Regular Sems: <br>
                <b style="font-size: 14px;">${path.semestersRemaining}</b> 
                <span style="color: #666;">(excl. midyears)</span>
            </div>
            <div class="stat">Units Passed: <b>${apiUnitsPassed}</b></div>
        </div>

        <h4>Courses Taken: </h4>
        <div class="audit-grid">
            ${Object.entries(report.audit || {}).map(([k, v]) => {
                if (!v) return ""; 
                let earned = v.earnedUnits ?? v.earnedCourses ?? 0;
                let required = v.requiredUnits ?? v.requiredCourses ?? 0;
                if (k === "HK") { earned = Math.floor((v.earnedUnits || 0) / 2); required = 3; }
                return `
                    <div class="audit-item">
                        <strong>${k}</strong> 
                        <span style="margin-left:auto;">${earned}/${required}</span>
                    </div>
                `;
            }).join("")}
        </div>

        <div class="tabs">
            <div class="tab-btn active" data-target="schedule">Recommended Courses</div>
            <div class="tab-btn" data-target="list">Courses to Take</div>
        </div>

        <div id="schedule" class="view active">
            ${path.recommendedCourses.map(c => `<div class="course"><b>${c.code}</b> ${c.title} (${c.units} Units)</div>`).join("")}
            <div class="totals-bar">
                <div>Total Academic Units: <b>${totalAcadUnits}</b></div>
                <div>Total Non-Acad Units: <b>${totalNonAcadUnits}</b></div>
            </div>
        </div>

        <div id="list" class="view">
            <div class="columns">
                <div class="card list-container">
                    <h3>🟢 Eligible</h3>
                    ${report.unlocked.map(c => `<div class="item eligible">
                            <b>${c.code}</b> (${c.units} units)
                            <span class="type">${c.type || "REQUIRED"}</span>
                            ${c.raw_prereq && c.raw_prereq.toLowerCase() !== "none" ? `<span class="prereq" style="color: #34a853;">(${c.raw_prereq})</span>` : ""}
                        </div>`).join("")}
                </div>
                <div class="card list-container">
                    <h3>🔴 Ineligible</h3>
                    ${report.locked.map(c => `<div class="item ineligible">
                            <b>${c.code}</b> (${c.units} units)
                            <span class="type">${c.type || "REQUIRED"}</span>
                            ${c.missing_reqs?.length ? `<span class="prereq">(${c.missing_reqs.join(" AND ")})</span>` : ""}
                        </div>`).join("")}
                </div>
            </div>
        </div>
    `;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.add('active');
        });
    });

    
    document.getElementById("exportBtn").addEventListener("click", async () => {
        try {
            const cssResponse = await fetch(chrome.runtime.getURL("popup/popup.css"));
            const cssText = await cssResponse.text();

            const win = window.open("", "_blank");
            win.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>AMIS Roadmap Export</title>
                    <style>
                        ${cssText}
                        @media print {
                            body { width: 100%; max-height: none; overflow: visible; }
                            .header-right { display: none; }
                            .view { display: block !important; }
                        }
                    </style>
                </head>
                <body style="padding: 20px;">
                    ${app.innerHTML}
                </body>
                </html>
            `);
            win.document.close();
            win.print();
        } catch (error) {
            console.error("Export failed:", error);
            alert("Failed to export the document.");
        }
    });
}

async function init() {
    try {
        const token = await AmisAPI.getToken();
        if (!token) throw new Error("Authentication token not found. Please log into AMIS.");

        const data = await AmisAPI.getStudentData(token);
        
        state.grades = data.grades;
        state.profile = data.profile;
        
        const records = data.profile.user.student.program_records;
        const activeRecord = records.find(r => r.status === 'ACTIVE' || r.is_active) || records[0];
        state.programId = activeRecord.academic_program_id;

        state.curriculumMap = await fetch(chrome.runtime.getURL("curriculums_with_prereqs/curriculum_map.json")).then(r => r.json());

        
        const gradesData = state.grades.student_grades || state.grades;
        const termInfo = analyzeAMISTerms(gradesData);
        state.lastTermType = termInfo.last;
        state.targetTerm = termInfo.defaultNext;

        render();

        app.addEventListener('change', (e) => {
            if (e.target.id === 'track') {
                localStorage.setItem(`curriculum_${state.programId}`, e.target.value);
                render(); 
            } else if (e.target.id === 'termSelector') {
                state.targetTerm = e.target.value;
                render(); 
            } else if (e.target.id === 'overloadToggle') {
                state.isOverloading = e.target.checked;
                render(); 
            }
        });
    } catch (e) {
        app.innerHTML = `<div class="error-message" style="padding: 20px; color: red;">❌ ${e.message}</div>`;
    }
}

init();