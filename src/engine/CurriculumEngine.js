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

    evaluateStatus(parsedPrereq, passedSet, currentRank = 1) {
        if (parsedPrereq.length === 0) return { isUnlocked: true, missingReqs: [] };
        let isUnlocked = true;
        let missingReqs = [];
        parsedPrereq.forEach(orCondition => {
            const hasCOI = orCondition.some(c => c.toUpperCase() === 'COI');
            if (hasCOI) return; 
            const conditionMet = orCondition.some(courseCode => {
                if (courseCode.toUpperCase().includes('JUNIOR STANDING')) return currentRank >= 3;
                return passedSet.has(courseCode);
            });
            if (!conditionMet) {
                isUnlocked = false;
                missingReqs.push(orCondition.join(" OR "));
            }
        });
        return { isUnlocked, missingReqs };
    }

    calculateDynamicTargets() {
        const targets = {
            "CORE_GE": { requiredCourses: 0, requiredUnits: 0, codes: new Set() },
            "GE_ELECTIVE": { requiredCourses: 0, requiredUnits: 0 },
            "ELECTIVE": { requiredCourses: 0, requiredUnits: 0 }
        };
        const countedCodes = new Set();
        this.courses.forEach((course, code) => {
            if (countedCodes.has(code)) return;
            if (course.title.includes("(GE)") && course.type === "REQUIRED") {
                const group = this.equivalenceGroups.find(g => g.includes(code)) || [code];
                group.forEach(c => countedCodes.add(c));
                targets.CORE_GE.codes.add(code);
                targets.CORE_GE.requiredCourses += 1;
                targets.CORE_GE.requiredUnits += course.units;
            }
        });
        const structures = this.curriculum.curriculum_structures || [];
        structures.forEach(sem => {
            targets.GE_ELECTIVE.requiredCourses += (sem.ge_elective_count || 0);
            targets.ELECTIVE.requiredCourses += (sem.elective_count || 0);
        });
        targets.GE_ELECTIVE.requiredUnits = targets.GE_ELECTIVE.requiredCourses * 3;
        targets.ELECTIVE.requiredUnits = targets.ELECTIVE.requiredCourses * 3;
        return targets;
    }
}