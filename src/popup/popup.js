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