export class CurriculumEngine {
    constructor(curriculumData, equivalenceGroups = [], customUnitRules = {}, unitOverrides = {}) {
        this.curriculum = curriculumData;
        this.equivalenceGroups = equivalenceGroups;
        this.customUnitRules = customUnitRules; 
        this.unitOverrides = unitOverrides;
        
        this.courses = this.flattenCourses(curriculumData.courses || curriculumData.curriculum_courses || []);
        this.dynamicTargets = this.calculateDynamicTargets();
        this.earnedGroups = new Set();
    }

    flattenCourses(courseArray) {
        const map = new Map();
        courseArray.forEach((entry) => {
            const code = entry?.code || entry?.course?.course_code || null;
            if (code) {
                const units = entry?.units || this.unitOverrides[code] || 3;
                map.set(code, {
                    title: entry?.title || entry?.course?.title || "N/A",
                    type: entry?.type || entry?.course_type || "REQUIRED",
                    raw_prereq: entry?.prerequisites || "",
                    parsed_prereq: this.parsePrereqString(entry?.prerequisites || ""),
                    units: units,
                    year: entry?.year,
                    sem: entry?.sem,
                    is_academic: entry?.course?.is_academic ?? true 
                });
            } else {
                console.warn("Roadmap Engine: Skipped a malformed course entry:", entry); 
            }
        });
        return map;
    }

    parsePrereqString(prereqStr) {
        if (!prereqStr || prereqStr.trim() === "" || prereqStr.toLowerCase() === "none") return [];
        let cleanStr = prereqStr.replace(/[\n\r]/g, " ").replace(/;/g, " and ").replace(/[()]/g, "").replace(/\./g, "").trim();
        if (cleanStr === "") return [];
        const andParts = cleanStr.split(/\s+and\s+|,\s+/i);
        return andParts.map(part => part.split(/\s+or\s+/i).map(c => c.trim()).filter(c => c.length > 0)).filter(part => part.length > 0);
    }
}