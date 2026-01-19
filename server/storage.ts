import {
  User,
  ProjectRequest,
  ProjectInteraction,
  type IUser,
  type IProjectRequest,
  type IProjectInteraction,
  type InsertUser,
  type UpsertUser,
  type InsertProjectRequest,
  type InsertProjectInteraction,
} from "./../shared/schema.js";
import mongoose from "mongoose";


export interface IStorage {
  // User operations
  getUser(id: string): Promise<IUser | null>;
  getUserByEmail(email: string): Promise<IUser | null>;
  getUserBySocialId(provider: string, socialId: string): Promise<IUser | null>;
  upsertUser(user: UpsertUser): Promise<IUser>;
  
  // Project request operations
  createProjectRequest(request: InsertProjectRequest): Promise<IProjectRequest>;
  getProjectRequests(userId: string): Promise<IProjectRequest[]>;
  getAllProjectRequests(): Promise<IProjectRequest[]>;
  updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null>;

  // Project interaction operations
  getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }>;
  upsertProjectInteraction(interaction: InsertProjectInteraction): Promise<IProjectInteraction>;
  getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<IUser | null> {
    return User.findById(id);
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    return User.findOne({ email });
  }

  async getUserBySocialId(provider: string, socialId: string): Promise<IUser | null> {
    const fieldMap: { [key: string]: string } = {
      google: 'googleId',
      discord: 'discordId',
      facebook: 'facebookId',
    };

    const field = fieldMap[provider];
    if (!field) return null;

    return User.findOne({ [field]: socialId });
  }

  async getUserByResetToken(token: string): Promise<IUser | null> {
    return User.findOne({ resetToken: token });
  }

  async updateUserResetToken(id: string, token: string, expiry: Date): Promise<void> {
    await User.findByIdAndUpdate(id, {
      resetToken: token,
      resetTokenExpiry: expiry,
      updatedAt: new Date(),
    });
  }

  async resetUserPassword(id: string, hashedPassword: string): Promise<void> {
    await User.findByIdAndUpdate(id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
      updatedAt: new Date(),
    });
  }

  async upsertUser(userData: any): Promise<IUser> {
    // Check if user exists by email or ID
    let existingUser: IUser | null = null;
    if (userData.id) {
      existingUser = await this.getUser(userData.id);
    } else if (userData.email) {
      existingUser = await this.getUserByEmail(userData.email);
    }

    if (existingUser) {
      // Filter out null/undefined values and only include fields that exist in the schema
      const updateData: any = {};
      const allowedFields = ['email', 'firstName', 'lastName', 'profileImageUrl', 'password', 'googleId', 'discordId', 'facebookId', 'username', 'resetToken', 'resetTokenExpiry'];

      for (const field of allowedFields) {
        if (userData[field] !== undefined) {
          updateData[field] = userData[field];
        }
      }

      updateData.updatedAt = new Date();

      console.log('Updating user profile with data:', { id: existingUser._id, ...updateData });

      // Update existing user
      const updatedUser = await User.findByIdAndUpdate(
        existingUser._id,
        updateData,
        { new: true }
      );

      console.log('User profile updated successfully:', { id: updatedUser!._id, profileImageUrl: updatedUser!.profileImageUrl ? 'exists' : 'null' });
      return updatedUser!;
    } else {
      // Create new user
      const newUser = new User(userData);
      const savedUser = await newUser.save();
      return savedUser;
    }
  }

  // Project request operations
  async createProjectRequest(requestData: InsertProjectRequest): Promise<IProjectRequest> {
    const request = new ProjectRequest({
      ...requestData,
      userId: new mongoose.Types.ObjectId(requestData.userId),
    });
    return request.save();
  }

  async getProjectRequests(userId: string): Promise<IProjectRequest[]> {
    return ProjectRequest.find({ userId: new mongoose.Types.ObjectId(userId) });
  }

  async getAllProjectRequests(): Promise<IProjectRequest[]> {
    return ProjectRequest.find({});
  }

  async updateProjectRequestStatus(id: string, status: string): Promise<IProjectRequest | null> {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true }
    );
  }

  // Project interaction operations
  async getProjectInteractions(projectId: string): Promise<{ likes: number, averageRating: number }> {
    const likesResult = await ProjectInteraction.countDocuments({
      projectId,
      isLiked: "true"
    });

    const ratingResult = await ProjectInteraction.aggregate([
      { $match: { projectId, rating: { $ne: null } } },
      { $group: { _id: null, average: { $avg: { $toDouble: "$rating" } } } }
    ]);

    return {
      likes: likesResult,
      averageRating: ratingResult.length > 0 ? ratingResult[0].average : 0,
    };
  }

  async getUserInteraction(projectId: string, userId: string): Promise<IProjectInteraction | null> {
    return ProjectInteraction.findOne({
      projectId,
      userId: new mongoose.Types.ObjectId(userId)
    });
  }

  async upsertProjectInteraction(interactionData: InsertProjectInteraction): Promise<IProjectInteraction> {
    const existing = await this.getUserInteraction(interactionData.projectId, interactionData.userId);

    if (existing) {
      const updateData: any = { updatedAt: new Date() };
      if (interactionData.isLiked !== undefined) updateData.isLiked = interactionData.isLiked;
      if (interactionData.rating !== undefined) updateData.rating = interactionData.rating;

      return ProjectInteraction.findByIdAndUpdate(
        existing._id,
        updateData,
        { new: true }
      ) as Promise<IProjectInteraction>;
    } else {
      const interaction = new ProjectInteraction({
        ...interactionData,
        userId: new mongoose.Types.ObjectId(interactionData.userId),
      });
      return interaction.save();
    }
  }
}

export const storage = new DatabaseStorage();
