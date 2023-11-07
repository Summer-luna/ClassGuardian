import { Injectable } from '@nestjs/common';
import { AddCourseDto, CheckInDto, DeleteCourseDto, GetCourseByNameDto, AttendanceTypeEditDto, GetAttendanceCodeDto, GetStudentAttendanceStateListDto } from './dto/course.dto';
import { PrismaService } from 'nestjs-prisma';
import { Attendance, Course, Prisma, UserOnCourse } from '@prisma/client';
import * as randomatic from 'randomatic';
import { UserOnCourseModel } from './model/course.model';

@Injectable()
export class CourseService {
  constructor(private prisma: PrismaService) {}

  /**
   *
   * @param course
   */
  async addCourse(course: AddCourseDto): Promise<UserOnCourseModel> {
    // Generate a new join code and attendance code if the generated code already exists in the database
    const joinCode = await this.generateUniqueJoinCode(6);

    const courseCount = await this.prisma.course.count({
      where: {
        OR: [{ name: course.name, semesterId: course.semesterId, startDate: course.startDate, endDate: course.endDate }]
      }
    });

    if (courseCount !== 0) {
      throw new Error('Course already exist in the database.');
    }

    const newCourse = await this.prisma.course.create({
      data: {
        name: course.name,
        joinCode: joinCode,
        description: course.description,
        location: course.location,
        semesterId: course.semesterId,
        startDate: course.startDate,
        endDate: course.endDate
      }
    });

    return this.prisma.userOnCourse.create({
      data: {
        userId: course.userId,
        courseId: newCourse.id
      },
      include: {
        Course: true
      }
    });
  }

  async studentEnroll(input: CheckInDto): Promise<UserOnCourse> {
    const targetCourse = await this.prisma.course.findUnique({
      where: {
        joinCode: input.joinCode
      }
    });

    return this.prisma.userOnCourse.create({
      data: {
        userId: input.studentId,
        courseId: targetCourse.id
      },
      include: {
        Course: true
      }
    });
  }

  async checkDuplicateJoinCode(joinCode: string): Promise<boolean> {
    const courseJoinCodeCount = await this.prisma.course.count({
      where: {
        joinCode: joinCode
      }
    });

    return courseJoinCodeCount !== 0;
  }

  async updateCourse(course: Prisma.CourseUncheckedUpdateInput): Promise<Course> {
    return this.prisma.course.update({
      where: {
        id: course.id.toString()
      },
      data: {
        name: course.name,
        description: course.description,
        location: course.location,
        semesterId: course.semesterId,
        startDate: course.startDate,
        endDate: course.endDate
      }
    });
  }

  async deleteCourse(input: DeleteCourseDto): Promise<Course> {
    try {
      await this.dropCourse(input);

      return this.prisma.course.delete({
        where: {
          id: input.courseId
        }
      });
    } catch (error) {
      throw new Error('Unable to delete course');
    }
  }

  async getCourseByName(courseName: GetCourseByNameDto): Promise<Course[]> {
    return this.prisma.course.findMany({
      where: {
        name: courseName.name,
        endDate: {
          gt: new Date().toISOString()
        }
      }
    });
  }

  async getStudentsByCourseId(courseId: string): Promise<UserOnCourse[]> {
    return this.prisma.userOnCourse.findMany({
      where: {
        courseId: courseId,
        User: {
          role: 0
        }
      },
      include: {
        Course: true,
        User: true
      }
    });
  }

  async getCourseById(courseId: string): Promise<Course> {
    return this.prisma.course.findUnique({
      where: {
        id: courseId
      },
      include: {
        User: {
          where: {
            User: {
              role: 1
            }
          },
          include: {
            User: true
          }
        }
      }
    });
  }

  async getAllCourses(): Promise<Course[]> {
    return this.prisma.course.findMany({
      where: {
        endDate: {
          gt: new Date().toISOString()
        }
      }
    });
  }

  async dropCourse(input: DeleteCourseDto): Promise<UserOnCourseModel> {
    return this.prisma.userOnCourse.delete({
      where: {
        courseId_userId: {
          courseId: input.courseId,
          userId: input.userId
        }
      }
    });
  }

  async generateUniqueJoinCode(size: number): Promise<string> {
    let joinCode = await this.generateRandomCode(size);
    let isDuplicateJoinCode = true;

    while (isDuplicateJoinCode) {
      isDuplicateJoinCode = await this.checkDuplicateJoinCode(joinCode);
      joinCode = await this.generateRandomCode(size);
    }

    return joinCode;
  }

  async takeAttendance(attendInform: AttendanceTypeInputDto): Promise<Attendance> {
    const isExist = await this.checkAttendance(attendInform);
    const isMatched = await this.checkAttendanceCode(attendInform.attendanceCode, attendInform.classId);
    let attendanceType = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!isMatched) {
      attendanceType = 1;
    }

    if (isExist) {
      throw new Error('Already checked in');
    }

    return this.prisma.attendance.create({
      data: {
        userId: attendInform.userId,
        classId: attendInform.classId,
        attendanceType: attendanceType
      }
    });
  }

  async checkAttendance(input: AttendanceTypeCheckDto): Promise<Attendance> {
    const { userId, classId } = input;
    const date = new Date();
    const { today, tomorrow } = this.getTodayAndYesterday(date);

    return this.prisma.attendance.findFirst({
      where: {
        userId: userId,
        classId: classId,
        created: {
          gte: today,
          lt: tomorrow // Next day
        }
      }
    });
  }

  getTodayAndYesterday = (today: Date) => {
    today.setHours(0, 0, 0, 0);
    return { today: today, tomorrow: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
  };

  async generateRandomCode(size: number): Promise<string> {
    return randomatic('0', size);
  }

  async checkAttendanceCode(code: string, classId: string): Promise<boolean> {
    const correctCode = await this.prisma.course.findUnique({
      select: {
        attendanceCode: true
      },
      where: {
        id: classId
      }
    });

    return correctCode && code === correctCode.attendanceCode;
  }

  async updateAttendanceState(id: string, attendanceType: number): Promise<Attendance> {
    return this.prisma.attendance.update({
      where: {
        id: id
      },
      data: {
        attendanceType: attendanceType
      }
    });
  }

  async getAttendanceCode(id: GetAttendanceCodeDto): Promise<string> {
    const attendanceCode = await this.prisma.course.findFirst({
      where: {
        id: id.classId
      }
    });
    return attendanceCode.attendanceCode;
  }

  async markAbsence(input: { id: string }) {
    const { id } = input;
    const date = new Date();
    const { today, tomorrow } = this.getTodayAndYesterday(date);

    const userList = await this.prisma.userOnCourse.findMany({
      where: {
        courseId: id,
        User: {
          role: 0,
          Attendance: {
            none: {
              created: {
                gte: today,
                lt: tomorrow // Next day
              }
            }
          }
        }
      }
    });

    const attendanceData = userList.map((user) => {
      return {
        userId: user.userId,
        classId: user.courseId,
        attendanceType: 1
      };
    });

    return this.prisma.attendance.createMany({
      data: attendanceData
    });
  }

  async updateAttendanceCode(input: GetAttendanceCodeDto) {
    const { classId, attendanceCode } = input;
    return this.prisma.course.update({
      where: {
        id: classId
      },
      data: {
        attendanceCode: attendanceCode
      }
    });
  }

  // async checkDuplicateAttendanceCode(attendanceCode: string): Promise<boolean> {
  //   const courseAttendanceCodeCount = await this.prisma.course.count({
  //     where: {
  //       attendanceCode: attendanceCode
  //     }
  //   });
  //
  //   return courseAttendanceCodeCount !== 0;
  // }

  async getStudentAttendanceStateList(inform: GetStudentAttendanceStateListDto): Promise<Attendance[]> {
    return this.prisma.attendance.findMany({
      where: {
        created: {
          gte: inform.startDate,
          lte: inform.endDate
        }
      }
    });
  }

  // async getProfessorByCourseId(courseId: string): Promise<User> {
  //   return this.prisma.course.findUnique({
  //     where: {
  //       id: courseId,
  //       Role: {
  //         role: 1
  //       }
  //     }
  //   });
  // }

  // async updateAttendanceStateForMissingStudent(id: string) {
  //   await this.initAttendanceCode(id);
  //   return this.prisma.attendance.updateMany({
  //     where: {
  //       attendanceType: null
  //     },
  //     data: {
  //       attendanceType: 1
  //     }
  //   });
  // }

  // async getUniqueCourse(course: Prisma.CourseWhereInput): Promise<Course> {
  //   return this.prisma.course.findFirst({
  //     where: {
  //       name: course.name,
  //       semesterId: course.semesterId,
  //       startDate: course.startDate,
  //       endDate: course.endDate
  //     }
  //   });
  // }
}
