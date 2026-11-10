import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const statuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const priorities = ['low', 'medium', 'high'];

router.use(authenticate, requireRole(['admin', 'agent']));

router.get('/', async (req: Request, res: Response) => {
  try {
    const where = req.user?.role === 'admin'
      ? {}
      : { OR: [{ assignedTo: req.user!.id }, { assignedTo: null }] };
    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }]
    });
    res.json({ tickets });
  } catch (err) {
    console.error('[Tickets] Fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve support tickets.' });
  }
});

router.post('/', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { customerId, customerName, customerEmail, subject, description, priority, assignedTo, followUpAt } = req.body;
    if (typeof customerName !== 'string' || !customerName.trim() ||
        typeof subject !== 'string' || !subject.trim() ||
        typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'Customer name, subject, and description are required.' });
      return;
    }
    if (priority !== undefined && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }
    if (assignedTo !== undefined && assignedTo !== null && typeof assignedTo !== 'string') {
      res.status(400).json({ error: 'Invalid ticket assignee.' });
      return;
    }
    if (assignedTo) {
      const assignee = await prisma.user.findFirst({ where: { id: assignedTo, role: 'agent' } });
      if (!assignee) {
        res.status(400).json({ error: 'Choose a valid support agent.' });
        return;
      }
    }
    if (followUpAt !== undefined && followUpAt !== null && typeof followUpAt !== 'string') {
      res.status(400).json({ error: 'Invalid follow-up date.' });
      return;
    }
    const parsedFollowUpAt = followUpAt ? new Date(followUpAt) : null;
    if (parsedFollowUpAt && Number.isNaN(parsedFollowUpAt.getTime())) {
      res.status(400).json({ error: 'Invalid follow-up date.' });
      return;
    }
    const ticket = await prisma.supportTicket.create({
      data: {
        customerId: customerId || null,
        customerName: customerName.trim(),
        customerEmail: customerEmail?.trim() || null,
        subject: subject.trim(),
        description: description.trim(),
        priority: priority || 'medium',
        assignedTo: assignedTo || null,
        followUpAt: parsedFollowUpAt
      }
    });
    res.status(201).json({ ticket });
  } catch (err) {
    console.error('[Tickets] Create error:', err);
    res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status, priority, assignedTo, followUpAt } = req.body;
    if (status !== undefined && !statuses.includes(status)) {
      res.status(400).json({ error: 'Invalid ticket status.' });
      return;
    }
    if (priority !== undefined && !priorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid ticket priority.' });
      return;
    }
    if (assignedTo !== undefined && assignedTo !== null && typeof assignedTo !== 'string') {
      res.status(400).json({ error: 'Invalid ticket assignee.' });
      return;
    }
    if (followUpAt !== undefined && followUpAt !== null && typeof followUpAt !== 'string') {
      res.status(400).json({ error: 'Invalid follow-up date.' });
      return;
    }
    const parsedFollowUpAt = followUpAt ? new Date(followUpAt) : null;
    if (parsedFollowUpAt && Number.isNaN(parsedFollowUpAt.getTime())) {
      res.status(400).json({ error: 'Invalid follow-up date.' });
      return;
    }

    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Support ticket not found.' });
      return;
    }

    let ticket;
    if (req.user?.role === 'admin') {
      if (assignedTo) {
        const assignee = await prisma.user.findFirst({ where: { id: assignedTo, role: 'agent' } });
        if (!assignee) {
          res.status(400).json({ error: 'Choose a valid support agent.' });
          return;
        }
      }
      ticket = await prisma.supportTicket.update({
        where: { id: req.params.id },
        data: {
          ...(status !== undefined ? { status } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(assignedTo !== undefined ? { assignedTo: assignedTo || null } : {}),
          ...(followUpAt !== undefined ? { followUpAt: parsedFollowUpAt } : {})
        }
      });
    } else {
      const agentId = req.user!.id;
      if (assignedTo !== undefined && assignedTo !== agentId) {
        res.status(403).json({ error: 'Agents may only claim unassigned tickets for themselves.' });
        return;
      }
      const claiming = existing.assignedTo === null && assignedTo === agentId;
      if (claiming && ['resolved', 'closed'].includes(existing.status)) {
        res.status(400).json({ error: 'Resolved or closed tickets cannot be claimed.' });
        return;
      }
      if (!claiming && existing.assignedTo !== agentId) {
        res.status(403).json({ error: 'You can only update tickets assigned to you or claim an unassigned ticket.' });
        return;
      }
      if (claiming) {
        const claim = await prisma.supportTicket.updateMany({
          where: { id: req.params.id, assignedTo: null },
          data: {
            assignedTo: agentId,
            ...(status !== undefined ? { status } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(followUpAt !== undefined ? { followUpAt: parsedFollowUpAt } : {})
          }
        });
        if (claim.count === 0) {
          res.status(409).json({ error: 'This ticket has already been claimed. Refresh the queue and try again.' });
          return;
        }
        ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: req.params.id } });
      } else {
        ticket = await prisma.supportTicket.update({
          where: { id: req.params.id },
          data: {
            ...(status !== undefined ? { status } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(followUpAt !== undefined ? { followUpAt: parsedFollowUpAt } : {})
          }
        });
      }
    }
    res.json({ ticket });
  } catch (err) {
    console.error('[Tickets] Update error:', err);
    res.status(500).json({ error: 'Failed to update support ticket.' });
  }
});

export default router;
