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

    calculateDependencyWeights() {
        const unlocks = new Map(); 
        this.courses.forEach((_, code) => unlocks.set(code, []));

        this.courses.forEach((courseData, targetCode) => {
            if (courseData.parsed_prereq) {
                courseData.parsed_prereq.forEach(orGroup => {
                    orGroup.forEach(prereqCode => {
                        if (unlocks.has(prereqCode)) {
                            unlocks.get(prereqCode).push(targetCode);
                        }
                    });
                });
            }
        });

        const weights = new Map();
        
        const getWeight = (code, visited = new Set()) => {
            if (weights.has(code)) return weights.get(code);
            if (visited.has(code)) return 0; 
            
            visited.add(code);
            let weight = 1; 
            
            const children = unlocks.get(code) || [];
            children.forEach(childCode => {
                weight += getWeight(childCode, new Set(visited));
            });
            
            weights.set(code, weight);
            return weight;
        };

        this.courses.forEach((_, code) => getWeight(code));
        return weights;
    }

    generateOptimalPath(report, targetTerm = "1", minAcad = 15, maxAcad = 20, maxNonAcad = 7, isOverloading = false) {
        const courseWeights = this.calculateDependencyWeights();

        const isMidyear = String(targetTerm).toUpperCase().startsWith("M");

        const actualMinAcad = isMidyear ? 3 : minAcad; 
        const actualMaxAcad = isMidyear ? (isOverloading ? 9 : 6) : (isOverloading ? 21 : maxAcad);
        const actualMaxNonAcad = isMidyear ? 5 : maxNonAcad;

        let remainingRequiredAcadUnits = 0;
        report.unlocked.concat(report.locked).forEach(course => {
           if (course.is_academic && course.type === "REQUIRED" && !course.title.includes("(GE)")) {
               remainingRequiredAcadUnits += course.units;
           }
        });

        let remainingCoreGEUnits = report.audit["CORE GE"].satisfied ? 0 : 
            Math.max(0, this.dynamicTargets.CORE_GE.requiredUnits - (report.audit["CORE GE"].earnedCourses * 3)); 
            
        let remainingGEElecUnits = report.audit["GE ELECTIVE"].satisfied ? 0 : 
            Math.max(0, this.dynamicTargets.GE_ELECTIVE.requiredUnits - (report.audit["GE ELECTIVE"].earnedCourses * 3));
            
        let remainingElecUnits = report.audit["ELECTIVE"].satisfied ? 0 : 
            Math.max(0, this.dynamicTargets.ELECTIVE.requiredUnits - (report.audit["ELECTIVE"].earnedCourses * 3));

        const totalRemainingAcadUnits = remainingRequiredAcadUnits + remainingCoreGEUnits + remainingGEElecUnits + remainingElecUnits;
        const avgLoadPerSem = 18;
        const estSemsLeft = Math.max(1, Math.ceil(totalRemainingAcadUnits / avgLoadPerSem));
        
        let targetAcadLoad = isMidyear 
            ? Math.min(actualMaxAcad, totalRemainingAcadUnits)
            : Math.max(actualMinAcad, Math.min(actualMaxAcad, Math.ceil(totalRemainingAcadUnits / estSemsLeft)));

        if (isOverloading) {
            targetAcadLoad = Math.min(actualMaxAcad, totalRemainingAcadUnits);
        }

        let majorPool = [];
        let coreGePool = [];
        let geElectivePool = [];
        let electivePool = [];
        let nonAcadPool = [];

        const isAvailableThisTerm = (course) => {
            if (!course.sem) return true; 
            const semStr = String(course.sem).toUpperCase();
            if (semStr === "ANY" || semStr === "BOTH") return true;
            if (isMidyear && (semStr.includes("M") || semStr.includes("MIDYEAR"))) return true;
            if (!isMidyear && semStr.includes(String(targetTerm))) return true;
            return false;
        };

        report.unlocked.forEach(course => {
            if (!isAvailableThisTerm(course)) return; 

            const nType = (course.type || "").toUpperCase();
            const isCoreGE = this.dynamicTargets.CORE_GE.codes.has(course.code);

            if (!course.is_academic) nonAcadPool.push(course);
            else if (course.type === "REQUIRED" && !isCoreGE) majorPool.push(course);
            else if (isCoreGE) coreGePool.push(course);
            else if (nType.includes("GE ELECTIVE")) geElectivePool.push(course);
            else if (nType.includes("ELECTIVE") && !nType.includes("GE")) electivePool.push(course);
        });

        const smartSort = (a, b) => {
            const weightA = courseWeights.get(a.code) || 1;
            const weightB = courseWeights.get(b.code) || 1;
            if (weightB !== weightA) return weightB - weightA; 
            return (parseInt(a.year) - parseInt(b.year)) || (parseInt(a.sem) - parseInt(b.sem));
        };

        majorPool.sort(smartSort);
        coreGePool.sort(smartSort);

        const schedule = [];
        let acadUnits = 0;
        let nonAcadUnits = 0;
        const usedEquivGroups = new Set();
        const getGroupKey = (code) => this.equivalenceGroups.find(g => g.includes(code))?.sort().join('|');

        
        let geElecSlotsUsed = 0;
        const MAX_GE_ELEC_SLOTS = isMidyear ? (isOverloading ? 2 : 1) : (isOverloading ? 3 : 2); 

        
        while (geElecSlotsUsed < MAX_GE_ELEC_SLOTS && coreGePool.length > 0 && acadUnits + 3 <= targetAcadLoad) {
            const course = coreGePool.shift();
            const groupKey = getGroupKey(course.code);
            if (groupKey && usedEquivGroups.has(groupKey)) continue;

            schedule.push({ ...course, category: 'ACADEMIC' });
            acadUnits += course.units;
            if (groupKey) usedEquivGroups.add(groupKey);
            geElecSlotsUsed++;
        }

        
        let geElecsNeeded = report.audit["GE ELECTIVE"] ? (report.audit["GE ELECTIVE"].requiredCourses - report.audit["GE ELECTIVE"].earnedCourses) : 0;
        while (geElecsNeeded > 0 && geElecSlotsUsed < MAX_GE_ELEC_SLOTS && geElectivePool.length > 0 && acadUnits + 3 <= targetAcadLoad) {
            const uniqueOptions = [...new Set(geElectivePool.map(c => c.code))].slice(0, 3).join(" / ");
            schedule.push({ code: `[GE ELEC]`, title: `${uniqueOptions}`, units: 3, category: 'ACADEMIC' });
            acadUnits += 3;
            geElecSlotsUsed++;
            geElectivePool.push(geElectivePool.shift()); 
            geElecsNeeded--;
        }

        
        let electivesNeeded = report.audit["ELECTIVE"] ? (report.audit["ELECTIVE"].requiredCourses - report.audit["ELECTIVE"].earnedCourses) : 0;
        while (electivesNeeded > 0 && geElecSlotsUsed < MAX_GE_ELEC_SLOTS && electivePool.length > 0 && acadUnits + 3 <= targetAcadLoad) {
            const uniqueOptions = [...new Set(electivePool.map(c => c.code))].slice(0, 3).join(" / ");
            schedule.push({ code: `[ELECTIVE]`, title: `${uniqueOptions}`, units: 3, category: 'ACADEMIC' });
            acadUnits += 3;
            geElecSlotsUsed++;
            electivePool.push(electivePool.shift());
            electivesNeeded--;
        }

        
        while (electivesNeeded > 0 && geElecSlotsUsed < MAX_GE_ELEC_SLOTS && acadUnits + 3 <= targetAcadLoad) {
            schedule.push({ code: `[ELECTIVE]`, title: `Any 3-Unit Free Elective`, units: 3, category: 'ACADEMIC' });
            acadUnits += 3;
            geElecSlotsUsed++;
            electivesNeeded--;
        }

        
        for (const course of majorPool) {
            const groupKey = getGroupKey(course.code);
            if (groupKey && usedEquivGroups.has(groupKey)) continue;

            if (acadUnits + course.units <= targetAcadLoad) {
                schedule.push({ ...course, category: 'ACADEMIC' });
                acadUnits += course.units;
                if (groupKey) usedEquivGroups.add(groupKey);
                course.added = true; 
            }
        }

        majorPool = majorPool.filter(c => !c.added);
        const fallbackPool = [...majorPool, ...coreGePool]; 

        
        for (const course of fallbackPool) {
            if (acadUnits >= targetAcadLoad && !isMidyear) break; 
            
            const groupKey = getGroupKey(course.code);
            if (groupKey && usedEquivGroups.has(groupKey)) continue;

            if (acadUnits + course.units <= actualMaxAcad) {
                schedule.push({ ...course, category: 'ACADEMIC' });
                acadUnits += course.units;
                if (groupKey) usedEquivGroups.add(groupKey);
            }
        }

        
        while (electivesNeeded > 0 && acadUnits + 3 <= targetAcadLoad) {
            schedule.push({ code: `[ELECTIVE]`, title: `Any 3-Unit Free Elective`, units: 3, category: 'ACADEMIC' });
            acadUnits += 3;
            electivesNeeded--;
        }

        
        const processedNonAcadGroups = new Set();

        for (const course of nonAcadPool) {
            const units = course.units;
            const groupKey = getGroupKey(course.code);

            if (groupKey && usedEquivGroups.has(groupKey)) continue;

            if (nonAcadUnits + units <= actualMaxNonAcad) {
                if (groupKey) {
                    if (processedNonAcadGroups.has(groupKey)) continue;
                    const options = nonAcadPool.filter(c => getGroupKey(c.code) === groupKey).map(c => c.code);
                    const uniqueOptions = [...new Set(options)].join(" / ");
                    schedule.push({ code: `HK`, title: `${uniqueOptions}`, units: units, category: 'NON-ACAD' });
                    nonAcadUnits += units;
                    processedNonAcadGroups.add(groupKey);
                    usedEquivGroups.add(groupKey);
                } else {
                    schedule.push({ ...course, category: 'NON-ACAD' });
                    nonAcadUnits += units;
                }
            }
        }

        const isSufficientLoad = isMidyear 
            ? (acadUnits === 0 || acadUnits >= actualMinAcad) 
            : acadUnits >= actualMinAcad;

        return {
            recommendedCourses: schedule,
            totalAcadUnits: acadUnits,
            totalNonAcadUnits: nonAcadUnits,
            targetLoad: targetAcadLoad,
            semestersRemaining: estSemsLeft,
            remainingAcadUnits: totalRemainingAcadUnits,
            isSufficient: isSufficientLoad
        };
    }

    analyzeRoadmap(passedArray, currentClassification = "Freshman") {
        const passedSet = new Set(passedArray);
        const report = { unlocked: [], locked: [], audit: {} };

        const standingRank = { "Freshman": 1, "Sophomore": 2, "Junior": 3, "Senior": 4 };
        const currentRank = standingRank[currentClassification] || 1;

        let totalEarnedUnits = 0;
        let earnedCoreGEUnits = 0, earnedCoreGECourses = 0;
        let earnedGEElecUnits = 0, earnedGEElecCourses = 0;
        let earnedElecUnits = 0, earnedElecCourses = 0;

        passedArray.forEach(code => {
            const course = this.courses.get(code);
            if (!course) return;

            totalEarnedUnits += (course.units || 0);
            const isHistKasGroup = (code === 'HIST 1' || code === 'KAS 1');

            if (this.dynamicTargets.CORE_GE.codes.has(code) || isHistKasGroup) {
                earnedCoreGECourses++;
                earnedCoreGEUnits += course.units;
            } else if (course.type === "GE ELECTIVE") {
                earnedGEElecCourses++;
                earnedGEElecUnits += course.units;
            } else if (course.type === "ELECTIVE" || course.type === "SSP ELECTIVE") {
                earnedElecCourses++;
                earnedElecUnits += course.units;
            }
        });

        report.totalEarnedUnits = totalEarnedUnits;

        report.audit["CORE GE"] = {
            earnedCourses: earnedCoreGECourses, requiredCourses: this.dynamicTargets.CORE_GE.requiredCourses,
            satisfied: earnedCoreGECourses >= this.dynamicTargets.CORE_GE.requiredCourses
        };

        report.audit["GE ELECTIVE"] = {
            earnedCourses: earnedGEElecCourses, requiredCourses: this.dynamicTargets.GE_ELECTIVE.requiredCourses,
            satisfied: earnedGEElecCourses >= this.dynamicTargets.GE_ELECTIVE.requiredCourses
        };

        report.audit["ELECTIVE"] = {
            earnedCourses: earnedElecCourses, requiredCourses: this.dynamicTargets.ELECTIVE.requiredCourses,
            satisfied: earnedElecCourses >= this.dynamicTargets.ELECTIVE.requiredCourses
        };

        if (this.customUnitRules && Object.keys(this.customUnitRules).length > 0) {
            for (const [category, config] of Object.entries(this.customUnitRules)) {
                const earnedUnits = passedArray.reduce((sum, code) => {
                    const course = this.courses.get(code);
                    if (!course) return sum;
                    const isMatch = config.filter ? config.filter(code, course) : (course.type === category);
                    return isMatch ? sum + (course.units || 0) : sum;
                }, 0);
                
                report.audit[category] = { 
                    earnedUnits: earnedUnits, 
                    requiredUnits: config.minUnits, 
                    satisfied: earnedUnits >= config.minUnits
                };
            }
        }

        this.courses.forEach((courseData, courseCode) => {
            let customBucket = null;
            if (this.customUnitRules) {
                for (const [category, config] of Object.entries(this.customUnitRules)) {
                    const isMatch = config.filter ? config.filter(courseCode, courseData) : (courseData.type === category);
                    if (isMatch) {
                        customBucket = category;
                        break;
                    }
                }
            }

            const isCustomIncomplete = customBucket && report.audit[customBucket] && !report.audit[customBucket].satisfied;

            if (!isCustomIncomplete) {
                if (passedSet.has(courseCode)) return;

                const group = this.equivalenceGroups.find(g => g.includes(courseCode)) || [];
                if (group.some(equivCode => passedSet.has(equivCode))) return;
            }

            if (report.audit["CORE GE"].satisfied && this.dynamicTargets.CORE_GE.codes.has(courseCode)) return;
            const nType = (courseData.type || "").toUpperCase();
            if (report.audit["GE ELECTIVE"].satisfied && nType.includes("GE ELECTIVE")) return;
            if (report.audit["ELECTIVE"].satisfied && nType.includes("ELECTIVE") && !nType.includes("GE")) return;

            const status = this.evaluateStatus(courseData.parsed_prereq, passedSet, currentRank);
            
            const courseRecord = {
                code: courseCode,
                title: courseData.title,
                type: courseData.type,
                year: courseData.year,
                sem: courseData.sem,
                units: courseData.units,
                is_academic: courseData.is_academic,
                raw_prereq: courseData.raw_prereq
            };

            if (status.isUnlocked) {
                report.unlocked.push(courseRecord);
            } else {
                courseRecord.missing_reqs = status.missingReqs;
                report.locked.push(courseRecord);
            }
        });

        return report;
    }
}