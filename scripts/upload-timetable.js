import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory (.env in project root)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize Firebase Admin
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

// Parser functions (copied from Flutter app)
class XlsxParser {
  static parseXlsxFile(filePath) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = 'Table 1';
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        throw new Error('Table 1 sheet not found');
      }
      
      return this.parseSheet(worksheet);
    } catch (error) {
      throw new Error(`Error parsing XLSX file: ${error.message}`);
    }
  }
  
  static parseSheet(worksheet) {
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const courses = [];
    
    if (data.length < 3) {
      throw new Error('Invalid sheet format');
    }
    
    let currentRow = 2; // Skip header rows
    
    while (currentRow < data.length) {
      const row = data[currentRow];
      
      if (!row || this.isEmptyRow(row)) {
        currentRow++;
        continue;
      }
      
      const compCode = this.getCellValue(row, 0);
      
      if (compCode && compCode.toString().trim() !== '') {
        const courseResult = this.parseCourseGroup(data, currentRow);
        if (courseResult) {
          courses.push(courseResult.course);
          currentRow = courseResult.nextRow;
        } else {
          currentRow++;
        }
      } else {
        currentRow++;
      }
    }
    
    return courses;
  }

  static parseCsvFile(filePath) {
    try {
      const csvContent = fs.readFileSync(filePath, 'utf8');
      const records = parse(csvContent, {
        columns: false, // Don't use first row as headers since it's just column numbers
        skip_empty_lines: true,
        trim: true
      });
      
      return this.parseCsvData(records);
    } catch (error) {
      throw new Error(`Error parsing CSV file: ${error.message}`);
    }
  }

  static parseCsvData(data) {
    const courses = [];
    
    if (data.length < 2) {
      throw new Error('Invalid CSV format');
    }
    
    let currentRow = 1; // Skip header row with column numbers
    
    while (currentRow < data.length) {
      const row = data[currentRow];
      
      if (!row || this.isEmptyRow(row)) {
        currentRow++;
        continue;
      }
      
      const compCode = this.getCellValue(row, 0);
      
      if (compCode && compCode.toString().trim() !== '') {
        const courseResult = this.parseCourseGroup(data, currentRow);
        if (courseResult) {
          courses.push(courseResult.course);
          currentRow = courseResult.nextRow;
        } else {
          currentRow++;
        }
      } else {
        currentRow++;
      }
    }
    
    return courses;
  }
  
  static parseCourseGroup(data, startRow) {
    const mainRow = data[startRow];
    
    const compCode = this.getCellValue(mainRow, 0);
    const courseNo = this.getCellValue(mainRow, 1);
    const courseTitle = this.getCellValue(mainRow, 2);
    const lectureCredits = this.getNumericValue(mainRow, 3);
    const practicalCredits = this.getNumericValue(mainRow, 4);
    const totalCredits = this.getNumericValue(mainRow, 5);
    
    if (!compCode || !courseNo || !courseTitle) {
      return null;
    }
    
    const sections = [];
    let currentRow = startRow;
    
    while (currentRow < data.length) {
      const row = data[currentRow];
      
      if (currentRow === startRow) {
        const mainSection = this.parseSection(data, startRow);
        if (mainSection) {
          sections.push(mainSection.section);
          currentRow = mainSection.nextRow;
        } else {
          currentRow++;
        }
      } else {
        const nextCompCode = this.getCellValue(row, 0);
        
        if (nextCompCode && nextCompCode.toString().trim() !== '') {
          break;
        }
        
        const sectionId = this.getCellValue(row, 6);
        if (sectionId && sectionId.toString().trim() !== '') {
          const sectionResult = this.parseSection(data, currentRow);
          if (sectionResult) {
            sections.push(sectionResult.section);
            currentRow = sectionResult.nextRow;
          } else {
            currentRow++;
          }
        } else {
          currentRow++;
        }
      }
    }
    
    const midSemExam = this.parseExamSchedule(this.getCellValue(mainRow, 11), true);
    const endSemExam = this.parseExamSchedule(this.getCellValue(mainRow, 12), false);
    
    const course = {
      courseCode: courseNo.toString(),
      courseTitle: courseTitle.toString(),
      lectureCredits: lectureCredits,
      practicalCredits: practicalCredits,
      totalCredits: totalCredits,
      sections: sections,
      midSemExam: midSemExam,
      endSemExam: endSemExam,
    };
    
    return { course, nextRow: currentRow };
  }
  
  static parseSection(data, startRow) {
    const row = data[startRow];
    const sectionId = this.getCellValue(row, 6);
    
    if (!sectionId || sectionId.toString().trim() === '') {
      return null;
    }
    
    const sectionIdStr = sectionId.toString().trim();
    const sectionType = this.parseSectionType(sectionIdStr);
    
    const instructors = [];
    const rooms = [];
    const schedule = [];
    
    let currentRow = startRow;
    
    while (currentRow < data.length) {
      const currentRowData = data[currentRow];
      
      if (currentRow > startRow) {
        const nextSectionId = this.getCellValue(currentRowData, 6);
        const nextCompCode = this.getCellValue(currentRowData, 0);
        
        if ((nextSectionId && nextSectionId.toString().trim() !== '') ||
            (nextCompCode && nextCompCode.toString().trim() !== '')) {
          break;
        }
      }
      
      const instructor = this.getCellValue(currentRowData, 7);
      const room = this.getCellValue(currentRowData, 8);
      const days = this.getCellValue(currentRowData, 9);
      const hours = this.getCellValue(currentRowData, 10);
      
      if (instructor && instructor.toString().trim() !== '') {
        const instructorStr = instructor.toString().trim();
        if (!instructors.includes(instructorStr)) {
          instructors.push(instructorStr);
        }
      }
      
      if (room && room.toString().trim() !== '') {
        const roomStr = room.toString().trim();
        if (!rooms.includes(roomStr)) {
          rooms.push(roomStr);
        }
      }
      
      if (days && days.toString().trim() !== '' && 
          hours && hours.toString().trim() !== '') {
        const daysStr = days.toString().trim();
        const hoursStr = this.formatCellValue(hours);
        
        const daysList = this.parseDays(daysStr);
        const hoursList = this.parseHours(hoursStr);
        
        if (daysList.length > 0 && hoursList.length > 0) {
          schedule.push({
            days: daysList,
            hours: hoursList,
          });
        }
      }
      
      currentRow++;
    }
    
    const section = {
      sectionId: sectionIdStr,
      type: sectionType,
      instructor: instructors.join(', '),
      room: rooms.join(', '),
      schedule: schedule,
    };
    
    return { section, nextRow: currentRow };
  }
  
  static parseSectionType(sectionId) {
    if (sectionId.startsWith('L')) return 'SectionType.L';
    if (sectionId.startsWith('P')) return 'SectionType.P';
    if (sectionId.startsWith('T')) return 'SectionType.T';
    return 'SectionType.L';
  }
  
  static parseDays(daysStr) {
    if (!daysStr) return [];
    
    const days = [];
    const dayMap = {
      'M': 'DayOfWeek.M',
      'T': 'DayOfWeek.T',
      'W': 'DayOfWeek.W',
      'Th': 'DayOfWeek.Th',
      'F': 'DayOfWeek.F',
      'S': 'DayOfWeek.S',
    };
    
    const parts = daysStr.split(' ');
    for (const part of parts) {
      const trimmed = part.trim();
      if (dayMap[trimmed]) {
        days.push(dayMap[trimmed]);
      }
    }
    
    return days;
  }
  
  static parseHours(hoursStr) {
    if (!hoursStr) return [];
    
    const cleaned = hoursStr.trim();
    
    try {
      // Split by spaces since hours are now space-separated (e.g., "6 7 8")
      const hourParts = cleaned.split(/\s+/);
      const hours = [];
      
      for (const part of hourParts) {
        const hourValue = parseInt(part);
        if (hourValue >= 1 && hourValue <= 12) {
          hours.push(hourValue);
        }
      }
      
      return hours;
    } catch (error) {
      console.log(`Error parsing hours "${hoursStr}": ${error}`);
      return [];
    }
  }
  
  static parseExamSchedule(examData, isMidSem) {
    if (!examData) return null;
    
    const examStr = examData.toString().trim();
    if (examStr === '') return null;
    
    try {
      if (isMidSem) {
        return this.parseMidSemExam(examStr);
      } else {
        return this.parseEndSemExam(examStr);
      }
    } catch (error) {
      return null;
    }
  }
  
  static parseMidSemExam(examStr) {
    const parts = examStr.split(' - ');
    if (parts.length < 2) return null;
    
    const datePart = parts[0].trim();
    const timePart = parts[1].trim();
    
    const dateComponents = datePart.split('/');
    if (dateComponents.length !== 2) return null;
    
    const day = parseInt(dateComponents[0]);
    const month = parseInt(dateComponents[1]);
    const year = 2025;
    
    let timeSlot;
    const cleanTimePart = timePart.replaceAll('.', ':').replaceAll(' ', '');
    
    if (cleanTimePart.includes('9:30') && cleanTimePart.includes('11:00')) {
      timeSlot = 'TimeSlot.MS1';
    } else if (cleanTimePart.includes('11:30') && cleanTimePart.includes('1:00')) {
      timeSlot = 'TimeSlot.MS2';
    } else if (cleanTimePart.includes('1:30') && cleanTimePart.includes('3:00')) {
      timeSlot = 'TimeSlot.MS3';
    } else if (cleanTimePart.includes('3:30') && cleanTimePart.includes('5:00')) {
      timeSlot = 'TimeSlot.MS4';
    } else {
      if (cleanTimePart.includes('9:30') || cleanTimePart.includes('930')) {
        timeSlot = 'TimeSlot.MS1';
      } else if (cleanTimePart.includes('11:30') || cleanTimePart.includes('1130')) {
        timeSlot = 'TimeSlot.MS2';
      } else if (cleanTimePart.includes('1:30') || cleanTimePart.includes('130')) {
        timeSlot = 'TimeSlot.MS3';
      } else if (cleanTimePart.includes('3:30') || cleanTimePart.includes('330')) {
        timeSlot = 'TimeSlot.MS4';
      } else {
        console.log(`Unknown MidSem time format: ${timePart}`);
        timeSlot = 'TimeSlot.MS1';
      }
    }
    
    // Create date string directly to avoid timezone issues
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    
    return {
      date: dateString,
      timeSlot: timeSlot,
    };
  }
  
  static parseEndSemExam(examStr) {
    const parts = examStr.split(' ');
    if (parts.length < 2) return null;
    
    const datePart = parts[0].trim();
    const timeSlotPart = parts[1].trim();
    
    const dateComponents = datePart.split('/');
    if (dateComponents.length !== 2) return null;
    
    const day = parseInt(dateComponents[0]);
    const month = parseInt(dateComponents[1]);
    const year = 2025;
    
    let timeSlot;
    if (timeSlotPart === 'FN') {
      timeSlot = 'TimeSlot.FN';
    } else if (timeSlotPart === 'AN') {
      timeSlot = 'TimeSlot.AN';
    } else {
      return null;
    }
    
    // Create date string directly to avoid timezone issues
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    
    return {
      date: dateString,
      timeSlot: timeSlot,
    };
  }
  
  static getCellValue(row, index) {
    return row && row[index] !== undefined ? row[index] : null;
  }
  
  static formatCellValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
      return value % 1 === 0 ? value.toString() : value.toString();
    }
    return value.toString();
  }
  
  static getNumericValue(row, index) {
    const value = this.getCellValue(row, index);
    if (value === null || value === undefined) return 0;
    
    if (typeof value === 'number') {
      return Math.round(value);
    } else if (typeof value === 'string') {
      try {
        const doubleValue = parseFloat(value);
        return Math.round(doubleValue);
      } catch (error) {
        return 0;
      }
    }
    
    return 0;
  }
  
  static isEmptyRow(row) {
    return !row || row.every(cell => cell === null || cell === undefined || cell.toString().trim() === '');
  }
}

async function uploadTimetableData(filePath) {
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    let courses;
    
    if (fileExtension === '.csv') {
      console.log('🔄 Parsing CSV file...');
      courses = XlsxParser.parseCsvFile(filePath);
    } else if (fileExtension === '.xlsx') {
      console.log('🔄 Parsing XLSX file...');
      courses = XlsxParser.parseXlsxFile(filePath);
    } else {
      throw new Error('Unsupported file format. Please use .csv or .xlsx files.');
    }
    
    console.log(`✅ Parsed ${courses.length} courses`);
    
    // Clear existing data
    console.log('🔄 Clearing existing course data...');
    const coursesRef = db.collection(process.env.COURSES_COLLECTION || 'courses');
    const snapshot = await coursesRef.get();
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    if (!snapshot.empty) {
      await batch.commit();
      console.log(`✅ Cleared ${snapshot.size} existing courses`);
    }
    
    // Upload new data in batches
    console.log('🔄 Uploading new course data...');
    const batchSize = 500; // Firestore batch limit
    
    for (let i = 0; i < courses.length; i += batchSize) {
      const batch = db.batch();
      const courseBatch = courses.slice(i, i + batchSize);
      
      courseBatch.forEach(course => {
        const docRef = coursesRef.doc(course.courseCode);
        batch.set(docRef, course);
      });
      
      await batch.commit();
      console.log(`✅ Uploaded courses ${i + 1} to ${Math.min(i + batchSize, courses.length)}`);
    }
    
    // Update metadata
    console.log('🔄 Updating metadata...');
    const metadataRef = db.collection(process.env.TIMETABLE_METADATA_COLLECTION || 'timetable_metadata').doc('current');
    await metadataRef.set({
      lastUpdated: new Date().toISOString(),
      totalCourses: courses.length,
      uploadedAt: new Date().toISOString(),
      version: Date.now().toString()
    });
    
    console.log('🎉 Upload completed successfully!');
    console.log(`📊 Total courses uploaded: ${courses.length}`);
    
  } catch (error) {
    console.error('❌ Error uploading timetable data:', error);
    process.exit(1);
  }
}

// Main execution
async function main() {
  let filePath = process.argv[2];
  
  // If no path provided, look for default files in parent directory
  if (!filePath) {
    const defaultCsvPath = path.join(__dirname, '.', 'output.csv');
    const defaultXlsxPath = path.join(__dirname, '..', 'DRAFT TIMETABLE I SEM 2025 -26.xlsx');
    
    if (fs.existsSync(defaultCsvPath)) {
      filePath = defaultCsvPath;
      console.log(`📂 Using default CSV file: ${path.basename(defaultCsvPath)}`);
    } else if (fs.existsSync(defaultXlsxPath)) {
      filePath = defaultXlsxPath;
      console.log(`📂 Using default XLSX file: ${path.basename(defaultXlsxPath)}`);
    } else {
      console.error('❌ Please provide the path to a CSV or XLSX file');
      console.log('Usage: npm run upload [path-to-file]');
      console.log('Or place "output.csv" or "DRAFT TIMETABLE I SEM 2025 -26.xlsx" in the project root');
      process.exit(1);
    }
  }
  
  if (!fs.existsSync(filePath)) {
    console.error('❌ File not found:', filePath);
    process.exit(1);
  }
  
  await uploadTimetableData(filePath);
}

main().catch(console.error);